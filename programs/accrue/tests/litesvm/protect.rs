use accrue::constants::TOKEN_PROGRAM_ID;
use accrue::guard::protect_amounts;
use accrue::scope::{
    add_the_slippage_buffer, minimum_output_the_oracle_allows, raw_amount_worth_rounding_down,
    raw_amount_worth_rounding_up, usd_value_of_scaled, SwapSide,
};
use solana_address::Address;
use solana_instruction::AccountMeta;
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::actions::{honest_route_data, hostile_route_data, OpenedPosition};
use crate::world::{World, ONYC_SCOPE_FEED_INDEX};

pub const USDC_DECIMALS: u8 = 6;
pub const DESTINATION_DECIMALS: u8 = 9;
pub const MIN_PROTECT_INTERVAL_SECONDS: i64 = 600;

pub struct PlannedSale {
    pub destination_to_sell: u64,
    pub usdc_out: u64,
    pub minimum_usdc_out: u64,
    pub repay_needed: u64,
    pub bounty: u64,
}

/// The same arithmetic a keeper runs off chain to size the sale the program is about to make.
pub fn plan_the_sale(world: &World, opened: &OpenedPosition) -> PlannedSale {
    let config = world.config();
    let position = world.position(&opened.address);
    let (borrowed, deposited) = world.obligation_values_scaled(&opened.obligation);
    let usdc_price = world.scope_price_scaled(world.borrow.snapshot.scope_feed_index);
    let destination_price = world.scope_price_scaled(ONYC_SCOPE_FEED_INDEX);

    let amounts = protect_amounts(
        borrowed,
        deposited,
        position.strategy.target_ltv_bps,
        config.keeper_bounty_bps,
        world.borrow_factor_pct(),
    )
    .unwrap();

    let repay_needed =
        raw_amount_worth_rounding_up(amounts.repay_usd_scaled, USDC_DECIMALS, usdc_price).unwrap();
    let bounty =
        raw_amount_worth_rounding_down(amounts.bounty_usd_scaled, USDC_DECIMALS, usdc_price)
            .unwrap()
            .min(config.keeper_bounty_cap_usdc);

    let to_raise = repay_needed + bounty;
    let at_the_oracle_price = raw_amount_worth_rounding_up(
        usd_value_of_scaled(to_raise, USDC_DECIMALS, usdc_price).unwrap(),
        DESTINATION_DECIMALS,
        destination_price,
    )
    .unwrap();

    let destination_held = world.token_balance(&opened.tokens.position_destination);
    let destination_to_sell = add_the_slippage_buffer(at_the_oracle_price, config.max_slippage_bps)
        .unwrap()
        .min(destination_held);

    let selling = SwapSide {
        raw_amount: destination_to_sell,
        decimals: DESTINATION_DECIMALS,
        price_scaled: destination_price,
    };
    let minimum_usdc_out = minimum_output_the_oracle_allows(
        &selling,
        USDC_DECIMALS,
        usdc_price,
        config.max_slippage_bps,
    )
    .unwrap();

    let usdc_out = raw_amount_worth_rounding_down(
        usd_value_of_scaled(destination_to_sell, DESTINATION_DECIMALS, destination_price).unwrap(),
        USDC_DECIMALS,
        usdc_price,
    )
    .unwrap();

    PlannedSale {
        destination_to_sell,
        usdc_out,
        minimum_usdc_out,
        repay_needed,
        bounty,
    }
}

pub fn selling_route(
    world: &World,
    opened: &OpenedPosition,
    extra: Option<Address>,
) -> Vec<AccountMeta> {
    world.swap_route_accounts(
        opened.address,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        TOKEN_PROGRAM_ID,
        extra,
    )
}

pub fn a_position_that_needs_the_guard(swap_program: &str) -> (World, OpenedPosition, Keypair) {
    let mut world = World::new();
    world.install_swap_program(swap_program);
    let opened = world.open_a_guarded_position();

    world.move_the_price(world.collateral.snapshot.scope_feed_index, 78, 100);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);

    let keeper = Keypair::new();
    world.svm.airdrop(&keeper.pubkey(), 10_000_000_000).unwrap();
    (world, opened, keeper)
}

pub fn keeper_usdc_account(world: &mut World, keeper: &Keypair) -> Address {
    world.create_token_account(
        world.borrow.liquidity_mint(),
        keeper.pubkey(),
        0,
        TOKEN_PROGRAM_ID,
    )
}

#[test]
fn a_stranger_can_protect_a_position_that_crossed_its_guard_level() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);

    let position = world.position(&opened.address);
    let loan_to_value_before = world.obligation_loan_to_value_bps(&opened.obligation);
    assert!(
        loan_to_value_before >= position.strategy.protect_ltv_bps,
        "the fall must actually cross the guard level, it reached {loan_to_value_before}"
    );

    let plan = plan_the_sale(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);
    let destination_before = world.token_balance(&opened.tokens.position_destination);

    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    let landed = world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "protect reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });
    println!("protect: {} compute units", landed.compute_units_consumed);

    let repaid = u64::try_from(
        (debt_before - world.obligation_debt(&opened.obligation))
            >> accrue::kamino::SCALED_FRACTION_BITS,
    )
    .unwrap();
    assert_eq!(
        repaid, plan.repay_needed,
        "the guard repaid exactly what the formula asked for"
    );
    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        destination_before - plan.destination_to_sell
    );
    assert_eq!(
        world.token_balance(&bounty_account),
        plan.bounty,
        "the caller is paid the bounty the config allows and nothing more"
    );

    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);
    let loan_to_value_after = world.obligation_loan_to_value_bps(&opened.obligation);
    assert!(
        loan_to_value_after <= position.strategy.target_ltv_bps,
        "protect must land at or below the target, it left {loan_to_value_after}"
    );

    let after = world.position(&opened.address);
    assert_eq!(after.protect_count, 1);
    assert_eq!(after.last_protect_at, world.now());
    assert_eq!(world.token_balance(&opened.tokens.position_collateral), 0);
}

#[test]
fn a_position_below_its_guard_level_is_left_alone() {
    let mut world = World::new();
    world.install_swap_program("honest_swap.so");
    let opened = world.open_a_guarded_position();
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);

    let keeper = Keypair::new();
    world.svm.airdrop(&keeper.pubkey(), 10_000_000_000).unwrap();
    let bounty_account = keeper_usdc_account(&mut world, &keeper);
    let debt_before = world.obligation_debt(&opened.obligation);

    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(1, 1),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a healthy position must not be touched");

    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
    assert_eq!(world.token_balance(&bounty_account), 0);
}

#[test]
fn a_second_protect_inside_the_interval_is_refused() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);

    let plan = plan_the_sale(&world, &opened);
    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world.send(&[instruction], &[&keeper]).unwrap();

    world.move_the_price(world.collateral.snapshot.scope_feed_index, 80, 100);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);
    world.move_time_forward(MIN_PROTECT_INTERVAL_SECONDS - 60);

    let debt_before = world.obligation_debt(&opened.obligation);
    let bounty_before = world.token_balance(&bounty_account);
    let plan = plan_the_sale(&world, &opened);
    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a protect inside the interval must be refused");

    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
    assert_eq!(world.token_balance(&bounty_account), bounty_before);

    world.move_time_forward(120);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);
    let plan = plan_the_sale(&world, &opened);
    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect("once the interval has elapsed the guard may act again");
    assert!(world.obligation_debt(&opened.obligation) < debt_before);
}

#[test]
fn a_second_protect_inside_the_interval_is_allowed_once_the_market_could_seize_it() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);

    let plan = plan_the_sale(&world, &opened);
    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world.send(&[instruction], &[&keeper]).unwrap();

    // Far enough for the market to liquidate, which is where waiting costs the owner everything.
    world.move_the_price(world.collateral.snapshot.scope_feed_index, 55, 100);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);
    world.move_time_forward(MIN_PROTECT_INTERVAL_SECONDS - 60);

    let liquidation_threshold_bps =
        world.collateral.snapshot.liquidation_threshold_pct as u16 * 100;
    assert!(
        world.obligation_loan_to_value_bps(&opened.obligation) >= liquidation_threshold_bps,
        "this test only means something with the position past the liquidation line"
    );

    let debt_before = world.obligation_debt(&opened.obligation);
    let plan = plan_the_sale(&world, &opened);
    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "a position the market could seize must not wait out the interval: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });
    assert!(world.obligation_debt(&opened.obligation) < debt_before);
}

#[test]
fn the_owner_never_waits_out_the_interval() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);

    let plan = plan_the_sale(&world, &opened);
    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world.send(&[instruction], &[&keeper]).unwrap();

    world.move_the_price(world.collateral.snapshot.scope_feed_index, 80, 100);
    world.refresh_the_market_from_outside();
    world.refresh_the_obligation_from_outside(opened.obligation);
    world.move_time_forward(MIN_PROTECT_INTERVAL_SECONDS - 60);

    let owner = world.owner.insecure_clone();
    let owner_usdc = opened.tokens.owner_usdc;
    let debt_before = world.obligation_debt(&opened.obligation);
    let plan = plan_the_sale(&world, &opened);
    let instruction = world.protect_instruction(
        &opened,
        owner.pubkey(),
        owner_usdc,
        plan.minimum_usdc_out,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "the owner must be able to protect inside the interval: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });
    assert!(world.obligation_debt(&opened.obligation) < debt_before);
}

#[test]
fn a_stale_oracle_stops_a_stranger_and_never_stops_the_owner() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);
    let plan = plan_the_sale(&world, &opened);

    world.make_the_price_stale(ONYC_SCOPE_FEED_INDEX, 1_000);

    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a stranger may not act on a stale price");
    assert_eq!(world.token_balance(&bounty_account), 0);

    let owner = world.owner.insecure_clone();
    let owner_usdc = opened.tokens.owner_usdc;
    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.protect_instruction(
        &opened,
        owner.pubkey(),
        owner_usdc,
        plan.minimum_usdc_out,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "the owner must be able to protect through a stale oracle: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });
    assert!(world.obligation_debt(&opened.obligation) < debt_before);
}

#[test]
fn the_minimum_a_stranger_supplies_is_ignored() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);
    let plan = plan_the_sale(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);

    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        u64::MAX,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect("the program computes its own minimum and ignores whatever the caller passed");

    assert!(world.obligation_debt(&opened.obligation) < debt_before);
    assert_eq!(world.token_balance(&bounty_account), plan.bounty);
}

#[test]
fn a_route_that_pays_under_the_oracle_minimum_is_refused_however_little_the_caller_asked_for() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);
    let plan = plan_the_sale(&world, &opened);
    let debt_before = world.obligation_debt(&opened.obligation);

    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.minimum_usdc_out - 1),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .expect_err("a fill one unit under the oracle minimum must revert");

    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
    assert_eq!(world.token_balance(&bounty_account), 0);
}

#[test]
fn the_bounty_never_rises_above_the_cap_in_the_config() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);

    let tiny_cap = 100;
    world
        .update_config(accrue::instructions::ConfigUpdate {
            limits: Some(accrue::state::ConfigLimits {
                keeper_bounty_cap_usdc: tiny_cap,
                ..crate::world::default_limits()
            }),
            ..Default::default()
        })
        .unwrap();

    let plan = plan_the_sale(&world, &opened);
    assert_eq!(plan.bounty, tiny_cap, "the plan must already be capped");

    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world.send(&[instruction], &[&keeper]).unwrap();

    assert_eq!(world.token_balance(&bounty_account), tiny_cap);
}

#[test]
fn a_destination_too_small_to_cover_the_repay_is_sold_in_full() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("honest_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);

    let crumbs = 200_000_000;
    world.set_token_account(
        opened.tokens.position_destination,
        world.destination_mint,
        opened.address,
        crumbs,
        world.destination_token_program,
    );

    let plan = plan_the_sale(&world, &opened);
    assert_eq!(
        plan.destination_to_sell, crumbs,
        "when the destination cannot cover the repay the guard sells all of it"
    );

    let debt_before = world.obligation_debt(&opened.obligation);
    let instruction = world.protect_instruction(
        &opened,
        keeper.pubkey(),
        bounty_account,
        0,
        honest_route_data(plan.destination_to_sell, plan.usdc_out),
        selling_route(&world, &opened, None),
    );
    world
        .send(&[instruction], &[&keeper])
        .unwrap_or_else(|failure| {
            panic!(
                "protect reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        0,
        "everything the position held was sold"
    );
    assert!(world.obligation_debt(&opened.obligation) < debt_before);
}

#[test]
fn a_hostile_route_on_protect_takes_nothing() {
    let (mut world, opened, keeper) = a_position_that_needs_the_guard("hostile_swap.so");
    let bounty_account = keeper_usdc_account(&mut world, &keeper);
    let plan = plan_the_sale(&world, &opened);

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
        let instruction = world.protect_instruction(
            &opened,
            keeper.pubkey(),
            bounty_account,
            0,
            hostile_route_data(mode, plan.destination_to_sell, plan.usdc_out / 4),
            selling_route(&world, &opened, Some(keeper.pubkey())),
        );
        world
            .send(&[instruction], &[&keeper])
            .err()
            .unwrap_or_else(|| panic!("protect let a route through that was {attack}"));

        assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
        assert_eq!(
            world.token_balance(&opened.tokens.position_destination),
            destination_before
        );
        assert_eq!(
            world.token_balance(&opened.tokens.position_usdc),
            usdc_before
        );
        assert_eq!(world.token_balance(&bounty_account), 0);
    }
}
