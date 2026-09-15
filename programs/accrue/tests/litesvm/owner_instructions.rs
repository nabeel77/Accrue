use accrue::state::{Position, PositionState, Strategy};
use anchor_lang::AccountDeserialize;
use solana_address::Address;
use solana_signer::Signer;

use crate::actions::{honest_route_data, NVDAX_STRATEGY};
use crate::world::World;

const HONEST_SWAP_PROGRAM: &str = "honest_swap.so";
const BORROW_AMOUNT: u64 = 4_000_000;
const POSITION_SIZE_USD: u64 = 20;

fn read_position(world: &World, address: &Address) -> Position {
    let account = world.svm.get_account(address).unwrap();
    Position::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn add_collateral_puts_more_stock_into_the_obligation_and_leaves_the_position_account_empty() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let obligation_before = world.obligation_collateral(&opened.obligation);
    let owner_stock_before = world.token_balance(&opened.tokens.owner_collateral);
    let more_stock = world.collateral.raw_amount_worth_usd(5);

    let owner = world.owner.insecure_clone();
    let instruction = world.add_collateral_instruction(&opened, owner.pubkey(), more_stock);
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "add_collateral reverted: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert!(world.obligation_collateral(&opened.obligation) > obligation_before);
    assert_eq!(
        world.token_balance(&opened.tokens.owner_collateral),
        owner_stock_before - more_stock
    );
    assert_eq!(world.token_balance(&opened.tokens.position_collateral), 0);
}

#[test]
fn repay_takes_usdc_from_the_owner_and_lowers_the_debt() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        world.owner.pubkey(),
        BORROW_AMOUNT,
        accrue::constants::TOKEN_PROGRAM_ID,
    );

    let debt_before = world.obligation_debt(&opened.obligation);
    let repay_amount = 1_000_000;

    let owner = world.owner.insecure_clone();
    let instruction = world.repay_instruction(&opened, owner.pubkey(), repay_amount);
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!("repay reverted: {:?} {:#?}", failure.err, failure.meta.logs)
        });

    assert!(world.obligation_debt(&opened.obligation) < debt_before);
    assert_eq!(
        world.token_balance(&opened.tokens.owner_usdc),
        BORROW_AMOUNT - repay_amount
    );
    assert_eq!(
        read_position(&world, &opened.address).usdc_repaid_total,
        repay_amount
    );
}

#[test]
fn repay_never_takes_more_than_the_debt() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let far_too_much = BORROW_AMOUNT * 10;
    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        world.owner.pubkey(),
        far_too_much,
        accrue::constants::TOKEN_PROGRAM_ID,
    );

    let owner = world.owner.insecure_clone();
    let instruction = world.repay_instruction(&opened, owner.pubkey(), far_too_much);
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!("repay reverted: {:?} {:#?}", failure.err, failure.meta.logs)
        });

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(
        world.token_balance(&opened.tokens.position_usdc),
        BORROW_AMOUNT
    );
    let taken = far_too_much - world.token_balance(&opened.tokens.owner_usdc);
    assert!(
        taken <= BORROW_AMOUNT + 1,
        "repay took {taken} for a {BORROW_AMOUNT} loan"
    );
}

#[test]
fn withdraw_collateral_sends_stock_to_the_owner_and_keeps_the_loan_under_target() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let owner_stock_before = world.token_balance(&opened.tokens.owner_collateral);
    let deposited = world.obligation_collateral(&opened.obligation);
    let taking_out = deposited / 10;

    let owner = world.owner.insecure_clone();
    let instruction = world.withdraw_collateral_instruction(&opened, owner.pubkey(), taking_out);
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "withdraw_collateral reverted: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(
        world.obligation_collateral(&opened.obligation),
        deposited - taking_out
    );
    assert!(world.token_balance(&opened.tokens.owner_collateral) > owner_stock_before);
    assert_eq!(world.token_balance(&opened.tokens.position_collateral), 0);
}

#[test]
fn withdraw_collateral_refuses_to_push_the_loan_above_target() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let deposited = world.obligation_collateral(&opened.obligation);
    let owner_stock_before = world.token_balance(&opened.tokens.owner_collateral);
    let owner = world.owner.insecure_clone();
    let instruction =
        world.withdraw_collateral_instruction(&opened, owner.pubkey(), deposited * 9 / 10);

    world
        .send(&[instruction], &[&owner])
        .expect_err("a withdrawal that leaves the loan above target must revert");

    assert_eq!(world.obligation_collateral(&opened.obligation), deposited);
    assert_eq!(
        world.token_balance(&opened.tokens.owner_collateral),
        owner_stock_before,
        "a reverted withdrawal moved stock"
    );
}

#[test]
fn set_strategy_accepts_a_guard_inside_the_bounds_and_refuses_one_outside_them() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    let owner = world.owner.insecure_clone();

    let tighter = Strategy {
        target_ltv_bps: 3_000,
        protect_ltv_bps: 4_500,
        grow_below_ltv_bps: 2_000,
        ..NVDAX_STRATEGY
    };
    let instruction = world.set_strategy_instruction(&opened, owner.pubkey(), tighter);
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "set_strategy reverted: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });
    assert_eq!(read_position(&world, &opened.address).strategy, tighter);

    let too_close_to_liquidation = Strategy {
        protect_ltv_bps: 6_200,
        ..NVDAX_STRATEGY
    };
    let instruction =
        world.set_strategy_instruction(&opened, owner.pubkey(), too_close_to_liquidation);
    world
        .send(&[instruction], &[&owner])
        .expect_err("a guard within five points of liquidation must be refused");
    assert_eq!(read_position(&world, &opened.address).strategy, tighter);
}

#[test]
fn unwind_from_awaiting_swap_repays_from_the_position_and_returns_everything() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let owner_stock_before = world.token_balance(&opened.tokens.owner_collateral);
    let owner = world.owner.insecure_clone();
    let instruction = world.unwind_instruction(&opened, owner.pubkey(), 0, Vec::new(), Vec::new());
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "unwind reverted: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(world.obligation_collateral(&opened.obligation), 0);
    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);
    assert_eq!(world.token_balance(&opened.tokens.position_destination), 0);
    assert_eq!(world.token_balance(&opened.tokens.position_collateral), 0);
    assert!(world.token_balance(&opened.tokens.owner_collateral) > owner_stock_before);
    assert_eq!(world.token_balance(&world.treasury_usdc_account), 0);
    assert_eq!(
        read_position(&world, &opened.address).state,
        PositionState::Closed
    );
}

#[test]
fn unwind_sells_the_destination_and_pays_the_fee_only_on_the_profit() {
    let mut world = World::new();
    world.install_swap_program(HONEST_SWAP_PROGRAM);
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let destination_bought = 4_000_000_000;
    world.set_token_account(
        opened.tokens.position_destination,
        world.destination_mint,
        opened.address,
        destination_bought,
        world.destination_token_program,
    );
    world.set_token_account(
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        opened.address,
        0,
        accrue::constants::TOKEN_PROGRAM_ID,
    );

    let sale_proceeds = BORROW_AMOUNT + 500_000;
    let route_accounts = world.swap_route_accounts(
        opened.address,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        None,
    );

    let owner = world.owner.insecure_clone();
    let instruction = world.unwind_instruction(
        &opened,
        owner.pubkey(),
        sale_proceeds,
        honest_route_data(destination_bought, sale_proceeds),
        route_accounts,
    );
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "unwind reverted: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });

    let debt_repaid = BORROW_AMOUNT;
    let profit = sale_proceeds - debt_repaid;
    let expected_fee = profit / 10;

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(
        world.token_balance(&world.treasury_usdc_account),
        expected_fee,
        "the fee is ten percent of the profit and nothing else"
    );
    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);
    assert!(world.token_balance(&opened.tokens.owner_usdc) >= profit - expected_fee);
}

#[test]
fn unwind_reverts_when_the_sale_cannot_cover_the_debt() {
    let mut world = World::new();
    world.install_swap_program(HONEST_SWAP_PROGRAM);
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let destination_bought = 4_000_000_000;
    world.set_token_account(
        opened.tokens.position_destination,
        world.destination_mint,
        opened.address,
        destination_bought,
        world.destination_token_program,
    );
    world.set_token_account(
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        opened.address,
        0,
        accrue::constants::TOKEN_PROGRAM_ID,
    );

    let not_enough = BORROW_AMOUNT / 2;
    let route_accounts = world.swap_route_accounts(
        opened.address,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        None,
    );

    let owner = world.owner.insecure_clone();
    let instruction = world.unwind_instruction(
        &opened,
        owner.pubkey(),
        not_enough,
        honest_route_data(destination_bought, not_enough),
        route_accounts,
    );
    world
        .send(&[instruction], &[&owner])
        .expect_err("an unwind that leaves a debt behind must revert");

    assert!(world.obligation_debt(&opened.obligation) > 0);
    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        destination_bought,
        "a reverted unwind leaves the destination untouched"
    );
    assert_eq!(world.token_balance(&world.treasury_usdc_account), 0);
}

#[test]
fn close_position_returns_the_rent_and_refuses_while_anything_is_left() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    let owner = world.owner.insecure_clone();

    let instruction = world.close_position_instruction(&opened, owner.pubkey());
    world
        .send(&[instruction], &[&owner])
        .expect_err("a position that still owes the market must not close");

    let unwind = world.unwind_instruction(&opened, owner.pubkey(), 0, Vec::new(), Vec::new());
    world.send(&[unwind], &[&owner]).unwrap_or_else(|failure| {
        panic!(
            "unwind reverted: {:?} {:#?}",
            failure.err, failure.meta.logs
        )
    });

    let owner_lamports_before = world.lamports_of(&owner.pubkey());
    let rent_in_the_accounts = world.lamports_of(&opened.address)
        + world.lamports_of(&opened.tokens.position_collateral)
        + world.lamports_of(&opened.tokens.position_usdc)
        + world.lamports_of(&opened.tokens.position_destination);
    println!(
        "rent still held by the position accounts: {rent_in_the_accounts} lamports (position {}, three token accounts {})",
        world.lamports_of(&opened.address),
        rent_in_the_accounts - world.lamports_of(&opened.address)
    );
    println!(
        "rent still held by the lending market: user metadata {}, obligation farm {}",
        world.lamports_of(&world.user_metadata_address(&opened.address)),
        world.lamports_of(&world.borrow_obligation_farm_state(&opened.obligation))
    );

    let instruction = world.close_position_instruction(&opened, owner.pubkey());
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "close_position reverted: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert!(world
        .svm
        .get_account(&opened.address)
        .is_none_or(|account| account.lamports == 0));
    assert!(world.lamports_of(&owner.pubkey()) > owner_lamports_before);
    assert!(
        rent_in_the_accounts > 0,
        "the position accounts held rent worth returning"
    );
}
