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
const RESERVE_STATUS_OBSOLETE: u8 = 2;
const A_MOMENT_THE_LIMIT_WAS_CROSSED: u64 = 1_753_830_774;

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

/// What the market looks like once it has actually started deleveraging a reserve: the setting is
/// on and the reserve has recorded the moment it crossed a limit.
fn start_deleveraging_the_collateral_reserve(world: &mut World) {
    let reserve = world.collateral.address;
    set_reserve_byte(world, reserve, RESERVE_AUTODELEVERAGE_OFFSET, 1);
    set_reserve_timestamp(
        world,
        reserve,
        RESERVE_DEPOSIT_LIMIT_CROSSED_OFFSET,
        A_MOMENT_THE_LIMIT_WAS_CROSSED,
    );
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

#[test]
fn a_reserve_flagged_for_deleverage_lets_anyone_hand_the_position_back() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);

    start_deleveraging_the_collateral_reserve(&mut world);

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

#[test]
fn the_deleverage_setting_on_its_own_is_not_a_reason_to_leave() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);

    let reserve = world.collateral.address;
    set_reserve_byte(&mut world, reserve, RESERVE_AUTODELEVERAGE_OFFSET, 1);

    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.leave_instruction(
        &opened,
        keeper.pubkey(),
        world.an_honest_fill(held, usdc_out),
        selling_route(&world, &opened, None),
    );
    world.send(&[instruction], &[&keeper]).expect_err(
        "a market wide setting with no deleveraging under way must not empty a position",
    );

    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        held
    );
}

#[test]
fn a_reserve_that_crossed_its_borrow_limit_while_deleveraging_lets_anyone_leave() {
    let (mut world, opened, keeper) = a_position_a_keeper_could_leave("honest_swap.so");
    let (held, usdc_out) = the_whole_destination_balance(&world, &opened);

    let reserve = world.collateral.address;
    set_reserve_byte(&mut world, reserve, RESERVE_AUTODELEVERAGE_OFFSET, 1);
    set_reserve_timestamp(
        &mut world,
        reserve,
        RESERVE_BORROW_LIMIT_CROSSED_OFFSET,
        A_MOMENT_THE_LIMIT_WAS_CROSSED,
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

    start_deleveraging_the_collateral_reserve(&mut world);

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
    start_deleveraging_the_collateral_reserve(&mut world);

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
    start_deleveraging_the_collateral_reserve(&mut world);

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
