use accrue::kamino::scaled_fraction_to_whole_units_rounding_up;
use accrue::state::{Position, PositionState, Strategy};
use anchor_lang::{AccountDeserialize, AnchorSerialize, Discriminator};
use solana_address::Address;
use solana_signer::Signer;

use crate::actions::{honest_route_data, NVDAX_STRATEGY};
use crate::world::World;

const HONEST_SWAP_PROGRAM: &str = "honest_swap.so";
const BORROW_AMOUNT: u64 = 4_000_000;
const POSITION_SIZE_USD: u64 = 20;

fn the_account_is_gone(world: &World, address: &Address) -> bool {
    world
        .svm
        .get_account(address)
        .is_none_or(|account| account.data.is_empty())
}

fn read_position(world: &World, address: &Address) -> Position {
    let account = world.svm.get_account(address).unwrap();
    Position::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn give_the_position_a_history_of_protects(
    world: &mut World,
    address: &Address,
    usdc_from_sales_total: u64,
    usdc_repaid_total: u64,
) {
    let mut account = world.svm.get_account(address).unwrap();
    let mut position = Position::try_deserialize(&mut account.data.as_slice()).unwrap();
    position.usdc_from_sales_total = usdc_from_sales_total;
    position.usdc_repaid_total = usdc_repaid_total;
    let mut written = Position::DISCRIMINATOR.to_vec();
    position.serialize(&mut written).unwrap();
    written.resize(account.data.len(), 0);
    account.data = written;
    world.svm.set_account(*address, account).unwrap();
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
fn unwind_never_charges_the_fee_on_principal_the_owner_repaid_from_their_wallet() {
    let mut world = World::new();
    world.install_swap_program(HONEST_SWAP_PROGRAM);
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let repaid_from_the_wallet = BORROW_AMOUNT / 2;
    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        world.owner.pubkey(),
        repaid_from_the_wallet,
        accrue::constants::TOKEN_PROGRAM_ID,
    );
    let owner = world.owner.insecure_clone();
    let repay = world.repay_instruction(&opened, owner.pubkey(), repaid_from_the_wallet);
    world.send(&[repay], &[&owner]).unwrap_or_else(|failure| {
        panic!("repay reverted: {:?} {:#?}", failure.err, failure.meta.logs)
    });

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

    let sale_proceeds = BORROW_AMOUNT + 160_000;
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

    let position = read_position(&world, &opened.address);
    assert_eq!(position.usdc_from_sales_total, sale_proceeds);
    assert!(
        position.usdc_repaid_total > repaid_from_the_wallet,
        "the wallet repayment and the unwind repayment must both be counted"
    );

    let repaid_inside_unwind = position.usdc_repaid_total - repaid_from_the_wallet;
    let charged = world.token_balance(&world.treasury_usdc_account);
    let expected = (sale_proceeds - position.usdc_repaid_total) / 10;
    let the_old_formula_would_have_charged = (sale_proceeds - repaid_inside_unwind) / 10;

    assert_eq!(
        charged, expected,
        "the fee base is every dollar the sales raised minus every dollar repaid"
    );
    assert!(
        charged < the_old_formula_would_have_charged,
        "charging on the unwind repayment alone would have taken {the_old_formula_would_have_charged} rather than {charged}"
    );
    assert_eq!(world.obligation_debt(&opened.obligation), 0);
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
fn the_same_seeds_can_be_opened_again_after_a_close() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    let owner = world.owner.insecure_clone();

    let unwind = world.unwind_instruction(&opened, owner.pubkey(), 0, Vec::new(), Vec::new());
    world.send(&[unwind], &[&owner]).unwrap_or_else(|failure| {
        panic!(
            "unwind reverted: {:?} {:#?}",
            failure.err, failure.meta.logs
        )
    });
    let close = world.close_position_instruction(&opened, owner.pubkey());
    world.send(&[close], &[&owner]).unwrap_or_else(|failure| {
        panic!(
            "close_position reverted: {:?} {:#?}",
            failure.err, failure.meta.logs
        )
    });
    assert!(the_account_is_gone(&world, &opened.address));

    let metadata = world.user_metadata_address(&opened.address);
    let farm_stake = world.borrow_obligation_farm_state(&opened.obligation);
    assert!(
        world.lamports_of(&metadata) > 0,
        "the lending market keeps the metadata record after a close"
    );
    assert!(
        world.lamports_of(&farm_stake) > 0,
        "the lending market keeps the farm stake after a close"
    );

    let reopened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    assert_eq!(
        reopened.address, opened.address,
        "the same owner, stock and destination must land on the same seeds"
    );
    assert_eq!(
        world.position(&reopened.address).state,
        PositionState::AwaitingSwap
    );
    assert!(world.obligation_debt(&reopened.obligation) > 0);

    let unwind = world.unwind_instruction(&reopened, owner.pubkey(), 0, Vec::new(), Vec::new());
    world.send(&[unwind], &[&owner]).unwrap_or_else(|failure| {
        panic!(
            "the second unwind reverted: {:?} {:#?}",
            failure.err, failure.meta.logs
        )
    });
    let close = world.close_position_instruction(&reopened, owner.pubkey());
    world.send(&[close], &[&owner]).unwrap_or_else(|failure| {
        panic!(
            "the second close reverted: {:?} {:#?}",
            failure.err, failure.meta.logs
        )
    });
    assert!(the_account_is_gone(&world, &reopened.address));
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

const RESERVE_BORROW_FACTOR_PCT_OFFSET: usize = 5_008;

fn set_borrow_factor(world: &mut World, percent: u64) {
    let reserve = world.borrow.address;
    let mut account = world.svm.get_account(&reserve).unwrap();
    account.data[RESERVE_BORROW_FACTOR_PCT_OFFSET..RESERVE_BORROW_FACTOR_PCT_OFFSET + 8]
        .copy_from_slice(&percent.to_le_bytes());
    world.svm.set_account(reserve, account).unwrap();
}

fn stock_returned_by_a_rescue(borrow_factor_pct: u64) -> u64 {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    set_borrow_factor(&mut world, borrow_factor_pct);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);

    let owner = world.owner.insecure_clone();
    let before = world.token_balance(&opened.tokens.owner_collateral);
    let instruction = world.rescue_instruction(&opened, owner.pubkey());
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "rescue reverted: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });

    world.token_balance(&opened.tokens.owner_collateral) - before
}

#[test]
fn rescue_withdraws_less_when_the_market_weights_the_debt_more_heavily() {
    let at_one_for_one = stock_returned_by_a_rescue(100);
    let weighted_higher = stock_returned_by_a_rescue(200);

    assert!(
        at_one_for_one > 0,
        "a rescue with room under the limit must return some stock"
    );
    assert!(
        weighted_higher < at_one_for_one,
        "a heavier borrow factor must leave more stock behind: {weighted_higher} against {at_one_for_one}"
    );
}

// Every fresh position is worth a little less than it owes: the swap costs something and interest
// starts at once. Closing has to work anyway, so the rest comes out of the owner's own account.
#[test]
fn unwind_takes_only_the_shortfall_from_the_owner_when_the_sale_falls_short() {
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

    let owner_usdc_before = 5_000_000;
    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        world.owner.pubkey(),
        owner_usdc_before,
        accrue::constants::TOKEN_PROGRAM_ID,
    );

    let debt_before = u64::try_from(scaled_fraction_to_whole_units_rounding_up(
        world.obligation_debt(&opened.obligation),
    ))
    .unwrap();
    let sale_proceeds = debt_before - 250_000;
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

    let shortfall = debt_before - sale_proceeds;
    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(
        world.token_balance(&opened.tokens.owner_usdc),
        owner_usdc_before - shortfall,
        "the owner pays the shortfall and not a unit more"
    );
    assert_eq!(
        world.token_balance(&world.treasury_usdc_account),
        0,
        "a sale that did not cover the loan made no profit to charge a fee on"
    );
    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);
    assert_eq!(world.position(&opened.address).state, PositionState::Closed);
}

#[test]
fn unwind_closes_when_a_profitable_history_meets_a_sale_the_owner_has_to_top_up() {
    let mut world = World::new();
    world.install_swap_program(HONEST_SWAP_PROGRAM);
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let sales_before = 12_249_908;
    let repaid_before = 12_115_297;
    give_the_position_a_history_of_protects(
        &mut world,
        &opened.address,
        sales_before,
        repaid_before,
    );
    let seeded = read_position(&world, &opened.address);
    assert_eq!(seeded.usdc_from_sales_total, sales_before);
    assert_eq!(seeded.usdc_repaid_total, repaid_before);
    assert_eq!(seeded.fee_bps_at_open, 1_000);

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

    let owner_usdc_before = 5_000_000;
    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        world.owner.pubkey(),
        owner_usdc_before,
        accrue::constants::TOKEN_PROGRAM_ID,
    );

    let debt_before = u64::try_from(scaled_fraction_to_whole_units_rounding_up(
        world.obligation_debt(&opened.obligation),
    ))
    .unwrap();

    let shortfall = 100_000;
    let sale_proceeds = debt_before - shortfall;
    assert!(
        sales_before + sale_proceeds > repaid_before + debt_before,
        "the history has to leave a profit for the fee to be charged on, \
         or this is not the position that failed on devnet"
    );

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
                "the fee reached past what the position held: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(
        world.token_balance(&opened.tokens.owner_usdc),
        owner_usdc_before - shortfall,
        "unwind takes exactly the debt from the owner and never a fee on top"
    );
    assert_eq!(
        world.token_balance(&world.treasury_usdc_account),
        0,
        "a position the owner had to top up has no profit in hand to charge"
    );
    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);
    assert_eq!(world.position(&opened.address).state, PositionState::Closed);
}

#[test]
fn unwind_names_the_shortfall_when_the_owner_cannot_cover_it() {
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
    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        world.owner.pubkey(),
        0,
        accrue::constants::TOKEN_PROGRAM_ID,
    );

    let debt_before = u64::try_from(scaled_fraction_to_whole_units_rounding_up(
        world.obligation_debt(&opened.obligation),
    ))
    .unwrap();
    let sale_proceeds = debt_before - 250_000;
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
    let failure = world
        .send(&[instruction], &[&owner])
        .expect_err("an empty wallet cannot cover the shortfall");

    let logs = format!("{:?}", failure.meta.logs);
    assert!(
        logs.contains("OwnerCannotCoverTheShortfall"),
        "the refusal names its own error: {logs}"
    );
    let shortfall = debt_before - sale_proceeds;
    assert!(
        logs.contains(&format!("closing needs {shortfall} more USDC")),
        "the refusal names the amount the app has to show: {logs}"
    );
}
