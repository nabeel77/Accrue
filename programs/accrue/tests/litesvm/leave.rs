use accrue::constants::TOKEN_PROGRAM_ID;
use accrue::state::{PositionState, Strategy};
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::actions::OpenedPosition;
use crate::protect::{selling_route, DESTINATION_DECIMALS, USDC_DECIMALS};
use crate::world::World;

const RESERVE_STATUS_OFFSET: usize = 4_856;
const RESERVE_AUTODELEVERAGE_OFFSET: usize = 5_502;
const RESERVE_DEPOSIT_LIMIT_CROSSED_OFFSET: usize = 280;
const RESERVE_BORROW_LIMIT_CROSSED_OFFSET: usize = 288;
const RESERVE_STATUS_ACTIVE: u8 = 0;
const RESERVE_STATUS_OBSOLETE: u8 = 1;
const RESERVE_STATUS_HIDDEN: u8 = 2;
const MARKET_AUTODELEVERAGE_OFFSET: usize = 123;
const OBLIGATION_MARGIN_CALL_STARTED_OFFSET: usize = 2_336;
const MARGIN_CALL_PERIOD_SECONDS: u64 = 604_800;

fn a_position_a_keeper_could_leave(swap_program: &str) -> (World, OpenedPosition, Keypair) {
    let mut world = World::new();
    world.install_swap_program(swap_program);
    let opened = world.open_a_guarded_position();
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);

    let keeper = Keypair::new();
    world.svm.airdrop(&keeper.pubkey(), 10_000_000_000).unwrap();
    (world, opened, keeper)
}

fn set_reserve_byte(world: &mut World, reserve: Address, offset: usize, value: u8) {
    let mut account = world.svm.get_account(&reserve).unwrap();
    account.data[offset] = value;
    world.svm.set_account(reserve, account).unwrap();
}

fn set_reserve_timestamp(world: &mut World, reserve: Address, offset: usize, value: u64) {
    let mut account = world.svm.get_account(&reserve).unwrap();
    account.data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    world.svm.set_account(reserve, account).unwrap();
}

fn set_market_byte(world: &mut World, offset: usize, value: u8) {
    let market = world.market;
    let mut account = world.svm.get_account(&market).unwrap();
    account.data[offset] = value;
    world.svm.set_account(market, account).unwrap();
}

fn set_obligation_timestamp(world: &mut World, obligation: Address, offset: usize, value: u64) {
    let mut account = world.svm.get_account(&obligation).unwrap();
    account.data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    world.svm.set_account(obligation, account).unwrap();
}

/// Everything Kamino needs before it deleverages a whole reserve: the market wide setting, the
/// reserve setting, a crossed limit, and a margin call period that has run out.
fn start_deleveraging_the_collateral_reserve(world: &mut World, crossed_at: u64) {
    let reserve = world.collateral.address;
    set_market_byte(world, MARKET_AUTODELEVERAGE_OFFSET, 1);
    set_reserve_byte(world, reserve, RESERVE_AUTODELEVERAGE_OFFSET, 1);
    set_reserve_timestamp(
        world,
        reserve,
        RESERVE_DEPOSIT_LIMIT_CROSSED_OFFSET,
        crossed_at,
    );
}

fn a_margin_call_that_has_run_out(world: &World) -> u64 {
    u64::try_from(world.now()).unwrap() - MARGIN_CALL_PERIOD_SECONDS
}

fn a_margin_call_still_running(world: &World) -> u64 {
    u64::try_from(world.now()).unwrap() - MARGIN_CALL_PERIOD_SECONDS + 1
}

/// Leaving sells everything the position holds, at the price the oracle reports.
fn the_whole_destination_balance(world: &World, opened: &OpenedPosition) -> (u64, u64) {
    let held = world.token_balance(&opened.tokens.position_destination);
    let usdc_out = accrue::scope::raw_amount_worth_rounding_down(
        accrue::scope::usd_value_of_scaled(
            held,
            DESTINATION_DECIMALS,
            world.scope_price_scaled(crate::world::ONYC_SCOPE_FEED_INDEX),
        )
        .unwrap(),
        USDC_DECIMALS,
        world.scope_price_scaled(world.borrow.snapshot.scope_feed_index),
    )
    .unwrap();
    (held, usdc_out)
}

#[test]
fn a_position_with_nothing_wrong_is_not_left() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);

    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a healthy market and a live program leave a position alone");

    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        held
    );
}

#[test]
fn a_reserve_the_market_retired_lets_anyone_hand_the_position_back() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);

    let reserve = world.collateral.address;
    set_reserve_byte(
        &mut world,
        reserve,
        RESERVE_STATUS_OFFSET,
        RESERVE_STATUS_OBSOLETE,
    );

    let owner_stock_before = world.token_balance(&opened.tokens.owner_collateral);
    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    let landed = world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "leave reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });
    println!("leave: {} compute units", landed.compute_units_consumed);

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(world.obligation_collateral(&opened.obligation), 0);
    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);
    assert_eq!(world.token_balance(&opened.tokens.position_destination), 0);
    assert_eq!(world.token_balance(&opened.tokens.position_collateral), 0);
    assert!(world.token_balance(&opened.tokens.owner_collateral) > owner_stock_before);
    assert_eq!(
        world.token_balance(&world.treasury_usdc_account),
        0,
        "leaving is never charged a fee"
    );
    assert_eq!(world.position(&opened.address).state, PositionState::Closed);
}

// Hidden is the market's own display flag, not a retirement: a hidden reserve still lends, so it
// is no more a reason to leave than an active one.
#[test]
fn only_an_obsolete_reserve_is_a_reason_to_leave() {
    for (status, is_a_reason) in [
        (RESERVE_STATUS_ACTIVE, false),
        (RESERVE_STATUS_OBSOLETE, true),
        (RESERVE_STATUS_HIDDEN, false),
    ] {
        let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
        let (held, usdc_out) = the_whole_destination_balance(&world, &opened);

        let reserve = world.collateral.address;
        set_reserve_byte(&mut world, reserve, RESERVE_STATUS_OFFSET, status);

        let instruction = world.leave_instruction(
            &opened,
            keeper.pubkey(),
            world.an_honest_fill(held, usdc_out),
            selling_route(&world, &opened, None),
        );
        let outcome = world.send(&[instruction], &[&keeper]);
        assert_eq!(
            outcome.is_ok(),
            is_a_reason,
            "status {status} should {} a leave",
            if is_a_reason { "allow" } else { "refuse" }
        );
    }
}

#[test]
fn a_reserve_flagged_for_deleverage_lets_anyone_hand_the_position_back() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);

    let crossed_at = a_margin_call_that_has_run_out(&world);
    start_deleveraging_the_collateral_reserve(&mut world, crossed_at);

    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "leave reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert!(world.token_balance(&opened.tokens.owner_usdc) > 0);
}

fn a_leave_must_be_refused(
    world: &mut World,
    opened: &OpenedPosition,
    keeper: &Keypair,
    why: &str,
) {
    let (held, usdc_out) = the_whole_destination_balance(world, opened);
    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.leave_instruction(
        opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(world, opened, None),
    );
    world.send(&[instruction], &[keeper]).expect_err(why);

    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        held
    );
}

#[test]
fn the_reserve_setting_on_its_own_is_not_a_reason_to_leave() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let reserve = world.collateral.address;
    set_reserve_byte(&mut world, reserve, RESERVE_AUTODELEVERAGE_OFFSET, 1);

    a_leave_must_be_refused(
        &mut world,
        &opened,
        &keeper,
        "a setting with no deleveraging under way must not empty a position",
    );
}

#[test]
fn a_deleveraging_reserve_on_a_market_that_is_not_deleveraging_is_refused() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let crossed_at = a_margin_call_that_has_run_out(&world);
    start_deleveraging_the_collateral_reserve(&mut world, crossed_at);
    set_market_byte(&mut world, MARKET_AUTODELEVERAGE_OFFSET, 0);

    a_leave_must_be_refused(
        &mut world,
        &opened,
        &keeper,
        "the lending market itself has to be deleveraging before a reserve counts",
    );
}

#[test]
fn a_margin_call_that_is_still_running_is_not_a_reason_to_leave() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let crossed_at = a_margin_call_still_running(&world);
    start_deleveraging_the_collateral_reserve(&mut world, crossed_at);

    a_leave_must_be_refused(
        &mut world,
        &opened,
        &keeper,
        "the owner gets the whole margin call period before anyone may act",
    );
}

#[test]
fn a_margin_call_on_this_one_obligation_is_a_reason_to_leave() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);

    let started_at = u64::try_from(world.now()).unwrap();
    let obligation = opened.obligation;
    set_obligation_timestamp(
        &mut world,
        obligation,
        OBLIGATION_MARGIN_CALL_STARTED_OFFSET,
        started_at,
    );

    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "leave reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(world.position(&opened.address).state, PositionState::Closed);
}

#[test]
fn a_reserve_that_crossed_its_borrow_limit_while_deleveraging_lets_anyone_leave() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);

    let reserve = world.collateral.address;
    let crossed_at = a_margin_call_that_has_run_out(&world);
    set_market_byte(&mut world, MARKET_AUTODELEVERAGE_OFFSET, 1);
    set_reserve_byte(&mut world, reserve, RESERVE_AUTODELEVERAGE_OFFSET, 1);
    set_reserve_timestamp(
        &mut world,
        reserve,
        RESERVE_BORROW_LIMIT_CROSSED_OFFSET,
        crossed_at,
    );

    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "leave reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(world.position(&opened.address).state, PositionState::Closed);
}

#[test]
fn a_flag_the_owner_switched_off_is_not_a_reason_to_leave() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let owner = world.owner.insecure_clone();
    let position = world.position(&opened.address);
    let instruction = world.set_strategy_instruction(
        &opened,
        owner.pubkey(),
        Strategy {
            exit_on_flag_enabled: false,
            ..position.strategy
        },
    );
    world.send(&[instruction], &[&owner]).unwrap();

    let crossed_at = a_margin_call_that_has_run_out(&world);
    start_deleveraging_the_collateral_reserve(&mut world, crossed_at);

    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a position whose owner switched the flag exit off must be left alone");
    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
}

#[test]
fn a_retiring_program_lets_anyone_hand_every_position_back() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let owner = world.owner.insecure_clone();
    let position = world.position(&opened.address);
    let instruction = world.set_strategy_instruction(
        &opened,
        owner.pubkey(),
        Strategy {
            exit_on_flag_enabled: false,
            ..position.strategy
        },
    );
    world.send(&[instruction], &[&owner]).unwrap();

    let admin = world.admin.insecure_clone();
    world.set_sunset_as(&admin).unwrap();

    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);
    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "leave reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(world.obligation_debt(&opened.obligation), 0);
    assert_eq!(world.position(&opened.address).state, PositionState::Closed);
    assert_eq!(world.token_balance(&world.treasury_usdc_account), 0);
}

#[test]
fn leaving_pays_the_owner_and_never_the_caller() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let keeper_usdc = world.create_token_account(
        world.borrow.liquidity_mint(),
        keeper.pubkey(),
        0,
        TOKEN_PROGRAM_ID,
    );
    let crossed_at = a_margin_call_that_has_run_out(&world);
    start_deleveraging_the_collateral_reserve(&mut world, crossed_at);

    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);
    let owner_usdc_before = world.token_balance(&opened.tokens.owner_usdc);
    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    world.send(&[instruction], &[&keeper]).unwrap();

    assert_eq!(
        world.token_balance(&keeper_usdc),
        0,
        "the caller earns nothing"
    );
    assert!(world.token_balance(&opened.tokens.owner_usdc) > owner_usdc_before);
}

#[test]
fn a_hostile_route_on_leave_takes_nothing() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("hostile_swap.so");
    let crossed_at = a_margin_call_that_has_run_out(&world);
    start_deleveraging_the_collateral_reserve(&mut world, crossed_at);

    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);
    let collateral_before = world.obligation_collateral(&opened.obligation);

    for (mode, attack) in [
        (0u8, "keeping the input"),
        (1, "paying under the minimum"),
        (6, "approving itself as delegate"),
        (7, "taking the owner authority"),
        (8, "setting a close authority"),
    ] {
        let instruction = world.leave_instruction(
            &opened,
            keeper.pubkey(),
            crate::actions::hostile_route_data(mode, held, usdc_out / 4),
            selling_route(&world, &opened, Some(keeper.pubkey())),
        );
        world
            .send(&[instruction], &[&keeper])
            .err()
            .unwrap_or_else(|| panic!("leave let a route through that was {attack}"));

        assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
        assert_eq!(
            world.obligation_collateral(&opened.obligation),
            collateral_before
        );
        assert_eq!(
            world.token_balance(&opened.tokens.position_destination),
            held
        );
    }
}

// Leaving is permissionless, so it never reaches into the owner's wallet. When the sale does not
// cover the loan it hands the position back part way instead, with the collateral still deposited
// and what is left owed written on the account.
#[test]
fn a_sale_that_falls_short_hands_the_position_back_still_owing() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");

    let reserve = world.collateral.address;
    set_reserve_byte(
        &mut world,
        reserve,
        RESERVE_STATUS_OFFSET,
        RESERVE_STATUS_OBSOLETE,
    );

    // The yield token is worth less than the loan, which is where every position starts, so even a
    // sale at the oracle's own price leaves something owed.
    let whole_balance = world.token_balance(&opened.tokens.position_destination);
    world.set_token_account(
        opened.tokens.position_destination,
        world.destination_mint,
        opened.address,
        whole_balance / 2,
        world.destination_token_program,
    );

    let debt_before = u64::try_from(accrue::kamino::scaled_fraction_to_whole_units_rounding_up(
        world.obligation_debt(&opened.obligation),
    ))
    .unwrap();
    let (held, short_sale) = the_whole_destination_balance(&world, &opened);
    assert!(
        short_sale < debt_before,
        "this test needs a sale that cannot cover the loan"
    );
    let collateral_before = world.obligation_collateral(&opened.obligation);
    let owner_usdc_before = world.token_balance(&opened.tokens.owner_usdc);

    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, short_sale),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "leave reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    let position = world.position(&opened.address);
    assert_eq!(position.state, PositionState::Closing);
    assert_eq!(
        position.usdc_owed_at_leave,
        debt_before - short_sale,
        "what is still owed is readable on the position"
    );
    assert_eq!(
        world.obligation_collateral(&opened.obligation),
        collateral_before,
        "the collateral stays deposited until the owner settles the rest"
    );
    assert_eq!(
        world.token_balance(&opened.tokens.owner_usdc),
        owner_usdc_before,
        "leaving never takes a unit from the owner's wallet"
    );
    assert_eq!(
        world.token_balance(&world.treasury_usdc_account),
        0,
        "leaving is never charged a fee"
    );
}

// The number leave leaves behind has to stay honest, so every repayment brings it down.
#[test]
fn repaying_after_a_leave_brings_what_is_owed_down_to_nothing() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");

    let reserve = world.collateral.address;
    set_reserve_byte(
        &mut world,
        reserve,
        RESERVE_STATUS_OFFSET,
        RESERVE_STATUS_OBSOLETE,
    );

    let whole_balance = world.token_balance(&opened.tokens.position_destination);
    world.set_token_account(
        opened.tokens.position_destination,
        world.destination_mint,
        opened.address,
        whole_balance / 2,
        world.destination_token_program,
    );
    let (held, short_sale) = the_whole_destination_balance(&world, &opened);

    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, short_sale),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "leave reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    let owed = world.position(&opened.address).usdc_owed_at_leave;
    assert!(owed > 0, "the leave has to have left something owed");
    assert_eq!(
        world.position(&opened.address).state,
        PositionState::Closing
    );

    let owner = world.owner.insecure_clone();
    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        owner.pubkey(),
        owed * 2,
        TOKEN_PROGRAM_ID,
    );
    let repay = world.repay_instruction(&opened, owner.pubkey(), owed);
    world.send(&[repay], &[&owner]).unwrap_or_else(|failure| {
        panic!(
            "repay reverted: {:?}\n{:#?}",
            failure.err, failure.meta.logs
        )
    });

    assert_eq!(
        world.position(&opened.address).usdc_owed_at_leave,
        0,
        "paying the owed amount leaves nothing owed on the account"
    );
}
