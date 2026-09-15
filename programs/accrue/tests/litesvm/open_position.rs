use accrue::state::{Position, PositionState, Strategy};
use anchor_lang::AccountDeserialize;
use solana_signer::Signer;

use crate::actions::{honest_route_data, NVDAX_STRATEGY};
use crate::world::World;

const HONEST_SWAP_PROGRAM: &str = "honest_swap.so";
const BORROW_AMOUNT: u64 = 4_000_000;
const POSITION_SIZE_USD: u64 = 20;

#[test]
fn an_open_that_stops_after_the_borrow_leaves_the_loan_awaiting_its_swap() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    assert_eq!(
        world.token_balance(&opened.tokens.position_usdc),
        BORROW_AMOUNT
    );
    assert_eq!(world.token_balance(&opened.tokens.position_collateral), 0);
    assert!(world.obligation_collateral(&opened.obligation) > 0);

    let account = world.svm.get_account(&opened.address).unwrap();
    let position = Position::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(position.state, PositionState::AwaitingSwap);
    assert_eq!(position.owner, world.owner.pubkey());
    assert_eq!(position.usdc_borrowed_total, BORROW_AMOUNT);
    assert_eq!(position.fee_bps_at_open, 1_000);
    assert_eq!(position.strategy, NVDAX_STRATEGY);

    let rent = [
        ("position", world.lamports_of(&opened.address)),
        (
            "stock token account",
            world.lamports_of(&opened.tokens.position_collateral),
        ),
        (
            "usdc token account",
            world.lamports_of(&opened.tokens.position_usdc),
        ),
        (
            "destination token account",
            world.lamports_of(&opened.tokens.position_destination),
        ),
        ("obligation", world.lamports_of(&opened.obligation)),
        (
            "user metadata",
            world.lamports_of(&world.user_metadata_address(&opened.address)),
        ),
        (
            "obligation debt farm",
            world.lamports_of(&world.borrow_obligation_farm_state(&opened.obligation)),
        ),
    ];
    let total: u64 = rent.iter().map(|(_, lamports)| lamports).sum();
    for (name, lamports) in rent {
        println!("rent {name}: {lamports} lamports");
    }
    println!("rent total at open: {total} lamports");
}

#[test]
fn buy_destination_finishes_the_split_open_and_moves_the_position_to_open() {
    let mut world = World::new();
    world.install_swap_program(HONEST_SWAP_PROGRAM);
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let destination_out = 3_900_000_000;
    let route_accounts = world.swap_route_accounts(
        opened.address,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        None,
    );

    world
        .buy_destination(
            &opened,
            destination_out,
            honest_route_data(BORROW_AMOUNT, destination_out),
            route_accounts,
        )
        .unwrap_or_else(|failure| {
            panic!(
                "buy_destination reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);
    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        destination_out
    );

    let account = world.svm.get_account(&opened.address).unwrap();
    let position = Position::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(position.state, PositionState::Open);
}

#[test]
fn one_open_deposits_borrows_and_buys_the_destination_in_a_single_instruction() {
    let mut world = World::new();
    world.install_swap_program(HONEST_SWAP_PROGRAM);

    let collateral_mint = world.collateral.liquidity_mint();
    let position = world.position_address(&collateral_mint, &world.destination_mint);
    let stock_amount = world.collateral.raw_amount_worth_usd(POSITION_SIZE_USD);
    let tokens = world.fund_owner_and_open_token_accounts(position, stock_amount);

    let destination_out = 3_900_000_000;
    let route_accounts = world.swap_route_accounts(
        position,
        tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        None,
    );

    let instruction = world.open_position_instruction(
        position,
        &tokens,
        stock_amount,
        BORROW_AMOUNT,
        destination_out,
        NVDAX_STRATEGY,
        false,
        honest_route_data(BORROW_AMOUNT, destination_out),
        route_accounts,
    );
    let owner = world.owner.insecure_clone();
    let landed = world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "open_position reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    println!(
        "one instruction open, compute units: {}",
        landed.compute_units_consumed
    );

    assert_eq!(world.token_balance(&tokens.position_usdc), 0);
    assert_eq!(
        world.token_balance(&tokens.position_destination),
        destination_out
    );
    let account = world.svm.get_account(&position).unwrap();
    assert_eq!(
        Position::try_deserialize(&mut account.data.as_slice())
            .unwrap()
            .state,
        PositionState::Open
    );
}

#[test]
fn an_open_below_the_minimum_size_is_refused() {
    assert_open_is_refused(1, 100_000, NVDAX_STRATEGY);
}

#[test]
fn an_open_above_the_maximum_size_is_refused() {
    assert_open_is_refused(500, 4_000_000, NVDAX_STRATEGY);
}

#[test]
fn an_open_that_borrows_past_the_target_is_refused() {
    assert_open_is_refused(POSITION_SIZE_USD, 12_000_000, NVDAX_STRATEGY);
}

#[test]
fn an_open_with_a_guard_too_close_to_liquidation_is_refused() {
    assert_open_is_refused(
        POSITION_SIZE_USD,
        BORROW_AMOUNT,
        Strategy {
            protect_ltv_bps: 6_200,
            ..NVDAX_STRATEGY
        },
    );
}

#[test]
fn an_open_with_a_grow_level_above_the_target_is_refused() {
    assert_open_is_refused(
        POSITION_SIZE_USD,
        BORROW_AMOUNT,
        Strategy {
            grow_below_ltv_bps: 4_500,
            ..NVDAX_STRATEGY
        },
    );
}

fn assert_open_is_refused(whole_dollars: u64, borrow_amount: u64, strategy: Strategy) {
    let mut world = World::new();
    let collateral_mint = world.collateral.liquidity_mint();
    let position = world.position_address(&collateral_mint, &world.destination_mint);
    let stock_amount = world.collateral.raw_amount_worth_usd(whole_dollars);
    let tokens = world.fund_owner_and_open_token_accounts(position, stock_amount);
    let owner_stock_before = world.token_balance(&tokens.owner_collateral);

    let instruction = world.open_position_instruction(
        position,
        &tokens,
        stock_amount,
        borrow_amount,
        0,
        strategy,
        true,
        Vec::new(),
        Vec::new(),
    );
    let owner = world.owner.insecure_clone();
    world
        .send(&[instruction], &[&owner])
        .expect_err("this open must be refused");

    assert!(world.svm.get_account(&position).is_none());
    assert_eq!(
        world.token_balance(&tokens.owner_collateral),
        owner_stock_before
    );
    assert_eq!(world.token_balance(&tokens.position_collateral), 0);
    assert_eq!(world.token_balance(&tokens.position_usdc), 0);
}
