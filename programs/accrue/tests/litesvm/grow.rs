use accrue::constants::TOKEN_PROGRAM_ID;
use accrue::guard::borrow_to_reach_target;
use accrue::instructions::ConfigUpdate;
use accrue::scope::{
    minimum_output_the_oracle_allows, raw_amount_worth_rounding_down, usd_value_of_scaled, SwapSide,
};
use accrue::state::{ConfigLimits, Strategy};
use solana_instruction::AccountMeta;
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::actions::OpenedPosition;
use crate::protect::{DESTINATION_DECIMALS, USDC_DECIMALS};
use crate::world::{default_limits, World, ONYC_SCOPE_FEED_INDEX};

const MIN_GROW_INTERVAL_SECONDS: i64 = 3_600;

struct PlannedGrow {
    borrowing: u64,
    destination_out: u64,
    minimum_destination_out: u64,
}

fn plan_the_grow(world: &World, opened: &OpenedPosition) -> PlannedGrow {
    let config = world.config();
    let position = world.position(&opened.address);
    let (borrowed, deposited) = world.obligation_values_scaled(&opened.obligation);
    let usdc_price = world.scope_price_scaled(world.borrow.snapshot.scope_feed_index);
    let destination_price = world.scope_price_scaled(ONYC_SCOPE_FEED_INDEX);

    let room = borrow_to_reach_target(
        borrowed,
        deposited,
        position.strategy.target_ltv_bps,
        world.borrow_factor_pct(),
    )
    .unwrap();
    let borrowing = raw_amount_worth_rounding_down(room, USDC_DECIMALS, usdc_price).unwrap();

    let selling = SwapSide {
        raw_amount: borrowing,
        decimals: USDC_DECIMALS,
        price_scaled: usdc_price,
    };
    let minimum_destination_out = minimum_output_the_oracle_allows(
        &selling,
        DESTINATION_DECIMALS,
        destination_price,
        config.max_slippage_bps,
    )
    .unwrap();
    let destination_out = raw_amount_worth_rounding_down(
        usd_value_of_scaled(borrowing, USDC_DECIMALS, usdc_price).unwrap(),
        DESTINATION_DECIMALS,
        destination_price,
    )
    .unwrap();

    PlannedGrow {
        borrowing,
        destination_out,
        minimum_destination_out,
    }
}

fn buying_route(world: &World, opened: &OpenedPosition) -> Vec<AccountMeta> {
    world.swap_route_accounts(
        opened.address,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        TOKEN_PROGRAM_ID,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        None,
    )
}

const SMALL_BORROW: u64 = 4_000_000;

fn a_position_with_room_to_grow_using(swap_program: &str) -> (World, OpenedPosition, Keypair) {
    let mut world = World::new();
    world.install_swap_program(swap_program);
    let destination_out = world.destination_worth_of(SMALL_BORROW);
    let opened = world.open_a_guarded_position_borrowing(SMALL_BORROW, destination_out);

    world.move_time_forward(MIN_GROW_INTERVAL_SECONDS + 60);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);

    let keeper = Keypair::new();
    world.svm.airdrop(&keeper.pubkey(), 10_000_000_000).unwrap();
    (world, opened, keeper)
}

fn a_position_with_room_to_grow() -> (World, OpenedPosition, Keypair) {
    a_position_with_room_to_grow_using("honest_swap.so")
}

#[test]
fn a_stranger_can_grow_a_position_that_fell_below_its_grow_level() {
    let (mut world, opened, keeper) = a_position_with_room_to_grow();
    let position = world.position(&opened.address);
    let loan_to_value_before = world.obligation_loan_to_value_bps(&opened.obligation);
    assert!(
        loan_to_value_before <= position.strategy.grow_below_ltv_bps,
        "the rise must actually cross the grow level, it reached {loan_to_value_before}"
    );

    let plan = plan_the_grow(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);
    let destination_before = world.token_balance(&opened.tokens.position_destination);

    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(plan.borrowing, plan.destination_out),
        buying_route(&world, &opened),
    );
    let landed = world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!("grow reverted: {:?}\n{:#?}", failure.err, failure.meta.logs)
        });
    println!("grow: {} compute units", landed.compute_units_consumed);

    assert!(world.obligation_debt(&opened.obligation) > debt_before);
    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        destination_before + plan.destination_out
    );
    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);

    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);
    assert!(
        world.obligation_loan_to_value_bps(&opened.obligation) <= position.strategy.target_ltv_bps,
        "grow must land at or below the target"
    );

    let after = world.position(&opened.address);
    assert_eq!(after.grow_count, 1);
    assert_eq!(after.last_grow_at, world.now());
}

#[test]
fn a_position_above_its_grow_level_is_left_alone() {
    let mut world = World::new();
    world.install_swap_program("honest_swap.so");
    let opened = world.open_a_guarded_position();
    world.move_time_forward(MIN_GROW_INTERVAL_SECONDS + 60);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);

    let keeper = Keypair::new();
    world.svm.airdrop(&keeper.pubkey(), 10_000_000_000).unwrap();
    let debt_before = world.obligation_debt(&opened.obligation);

    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(1, 1),
        buying_route(&world, &opened),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a position already at its band must not grow");
    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
}

#[test]
fn a_paused_guardian_stops_growing_and_nothing_else() {
    let (mut world, opened, keeper) = a_position_with_room_to_grow();
    let guardian = world.guardian.insecure_clone();
    world.set_paused_as(&guardian, None, Some(true)).unwrap();

    let plan = plan_the_grow(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(plan.borrowing, plan.destination_out),
        buying_route(&world, &opened),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a paused guardian must stop growing");
    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);

    world.set_paused_as(&guardian, None, Some(false)).unwrap();
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);
    let plan = plan_the_grow(&world, &opened);
    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(plan.borrowing, plan.destination_out),
        buying_route(&world, &opened),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect("unpausing lets the guard grow again");
    assert!(world.obligation_debt(&opened.obligation) > debt_before);
}

#[test]
fn a_position_with_growing_switched_off_is_left_alone() {
    let (mut world, opened, keeper) = a_position_with_room_to_grow();
    let owner = world.owner.insecure_clone();
    let position = world.position(&opened.address);
    let instruction = world.set_strategy_instruction(
        &opened,
        owner.pubkey(),
        Strategy {
            grow_enabled: false,
            ..position.strategy
        },
    );
    world.send(&[instruction], &[&owner]).unwrap();

    let plan = plan_the_grow(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(plan.borrowing, plan.destination_out),
        buying_route(&world, &opened),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a position whose owner switched growing off must not grow");
    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
}

#[test]
fn a_second_grow_inside_the_interval_is_refused() {
    let (mut world, opened, keeper) = a_position_with_room_to_grow();
    let plan = plan_the_grow(&world, &opened);
    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(plan.borrowing, plan.destination_out),
        buying_route(&world, &opened),
    );
    world.send(&[instruction], &[&keeper]).unwrap();

    let owner = world.owner.insecure_clone();
    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        owner.pubkey(),
        SMALL_BORROW,
        TOKEN_PROGRAM_ID,
    );
    let repay = world.repay_instruction(&opened, owner.pubkey(), 2_500_000);
    world.send(&[repay], &[&owner]).unwrap();

    world.move_time_forward(MIN_GROW_INTERVAL_SECONDS - 60);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);

    let debt_before = world.obligation_debt(&opened.obligation);
    let plan = plan_the_grow(&world, &opened);
    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(plan.borrowing, plan.destination_out),
        buying_route(&world, &opened),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a grow inside the interval must be refused");
    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
}

#[test]
fn a_grow_that_would_take_too_much_of_the_free_liquidity_is_refused() {
    let (mut world, opened, keeper) = a_position_with_room_to_grow();
    let plan = plan_the_grow(&world, &opened);

    let available = u128::from(world.borrow.snapshot.liquidity_available_amount);
    let just_under = u16::try_from((u128::from(plan.borrowing - 1) * 10_000) / available).unwrap();
    world
        .update_config(ConfigUpdate {
            limits: Some(ConfigLimits {
                max_share_of_available_bps: just_under,
                ..default_limits()
            }),
            ..Default::default()
        })
        .unwrap();

    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(plan.borrowing, plan.destination_out),
        buying_route(&world, &opened),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a borrow above the share of free liquidity must be refused");
    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
}

#[test]
fn a_stale_oracle_stops_a_stranger_growing() {
    let (mut world, opened, keeper) = a_position_with_room_to_grow();
    let plan = plan_the_grow(&world, &opened);
    world.make_the_price_stale(ONYC_SCOPE_FEED_INDEX, 1_000);

    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.grow_instruction(
        &opened,
        keeper.pubkey(),
        0,
        world.an_honest_fill(plan.borrowing, plan.destination_out),
        buying_route(&world, &opened),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a stranger may not grow on a stale price");
    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
}

#[test]
fn a_hostile_route_on_grow_takes_nothing() {
    let (mut world, opened, keeper) = a_position_with_room_to_grow_using("hostile_swap.so");
    let plan = plan_the_grow(&world, &opened);

    let debt_before = world.obligation_debt(&opened.obligation);
    let destination_before = world.token_balance(&opened.tokens.position_destination);
    let usdc_before = world.token_balance(&opened.tokens.position_usdc);

    for (mode, attack) in [
        (0u8, "keeping the input"),
        (1, "paying under the minimum"),
        (6, "approving itself as delegate"),
        (7, "taking the owner authority"),
        (8, "setting a close authority"),
    ] {
        let mut route = buying_route(&world, &opened);
        route.push(AccountMeta::new(keeper.pubkey(), false));
        let instruction = world.grow_instruction(
            &opened,
            keeper.pubkey(),
            0,
            crate::actions::hostile_route_data(
                mode,
                plan.borrowing,
                plan.minimum_destination_out / 4,
            ),
            route,
        );
        world
            .send(&[instruction], &[&keeper])
            .err()
            .unwrap_or_else(|| panic!("grow let a route through that was {attack}"));

        assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
        assert_eq!(
            world.token_balance(&opened.tokens.position_destination),
            destination_before
        );
        assert_eq!(
            world.token_balance(&opened.tokens.position_usdc),
            usdc_before
        );
    }
}
