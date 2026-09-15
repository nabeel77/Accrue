use accrue::constants::{
    KEEPER_BOUNTY_BPS_CEILING, PERFORMANCE_FEE_BPS_CEILING, SHARE_OF_AVAILABLE_BPS_CEILING,
    SLIPPAGE_BPS_CEILING,
};
use accrue::instructions::ConfigUpdate;
use accrue::state::{ConfigLimits, PositionState};
use solana_signer::Signer;

use crate::actions::NVDAX_STRATEGY;
use crate::world::{default_limits, World};

const BORROW_AMOUNT: u64 = 4_000_000;
const POSITION_SIZE_USD: u64 = 20;

#[test]
fn only_the_admin_may_change_the_config() {
    let mut world = World::new();
    let stranger = world.stranger.insecure_clone();
    let guardian = world.guardian.insecure_clone();

    let raise_the_cap = ConfigUpdate {
        limits: Some(ConfigLimits {
            max_position_usd: 1_000_000,
            ..default_limits()
        }),
        ..Default::default()
    };

    world
        .update_config_as(&stranger, raise_the_cap.clone())
        .expect_err("a stranger must not change the config");
    world
        .update_config_as(&guardian, raise_the_cap.clone())
        .expect_err("the guardian must not change the config");
    assert_eq!(world.config().max_position_usd, 50);

    world
        .update_config(raise_the_cap)
        .expect("the admin may change the config");
    assert_eq!(world.config().max_position_usd, 1_000_000);
}

#[test]
fn the_config_refuses_every_limit_above_the_ceiling_written_in_the_program() {
    let mut world = World::new();

    let above_the_ceilings = [
        ConfigLimits {
            performance_fee_bps: PERFORMANCE_FEE_BPS_CEILING + 1,
            ..default_limits()
        },
        ConfigLimits {
            max_slippage_bps: SLIPPAGE_BPS_CEILING + 1,
            ..default_limits()
        },
        ConfigLimits {
            keeper_bounty_bps: KEEPER_BOUNTY_BPS_CEILING + 1,
            ..default_limits()
        },
        ConfigLimits {
            max_share_of_available_bps: SHARE_OF_AVAILABLE_BPS_CEILING + 1,
            ..default_limits()
        },
        ConfigLimits {
            min_protect_interval_seconds: 30,
            ..default_limits()
        },
        ConfigLimits {
            min_grow_interval_seconds: 60,
            ..default_limits()
        },
        ConfigLimits {
            min_position_usd: 100,
            max_position_usd: 50,
            ..default_limits()
        },
    ];

    for limits in above_the_ceilings {
        world
            .update_config(ConfigUpdate {
                limits: Some(limits),
                ..Default::default()
            })
            .expect_err("a limit above the ceiling in code must be refused");
    }

    let config = world.config();
    assert_eq!(config.performance_fee_bps, 1_000);
    assert_eq!(config.max_slippage_bps, 100);
    assert_eq!(config.keeper_bounty_bps, 10);
    assert_eq!(config.max_share_of_available_bps, 1_000);
}

#[test]
fn the_guardian_may_pause_and_nothing_else() {
    let mut world = World::new();
    let guardian = world.guardian.insecure_clone();
    let stranger = world.stranger.insecure_clone();

    world
        .set_paused_as(&stranger, Some(true), None)
        .expect_err("a stranger must not pause");
    assert!(!world.config().open_paused);

    world
        .set_paused_as(&guardian, Some(true), Some(true))
        .expect("the guardian may pause");
    let config = world.config();
    assert!(config.open_paused);
    assert!(config.grow_paused);

    world
        .set_sunset_as(&guardian)
        .expect_err("the guardian must not retire the program");
    assert!(!world.config().sunset);

    world
        .set_paused_as(&guardian, Some(false), Some(false))
        .expect("the guardian may unpause");
    assert!(!world.config().open_paused);
}

#[test]
fn a_paused_program_refuses_a_new_position_and_still_lets_one_out() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let guardian = world.guardian.insecure_clone();
    world.set_paused_as(&guardian, Some(true), None).unwrap();

    let second =
        world.position_address(&world.collateral.liquidity_mint(), &world.destination_mint);
    let instruction = world.open_position_instruction(
        second,
        &opened.tokens,
        world.collateral.raw_amount_worth_usd(POSITION_SIZE_USD),
        BORROW_AMOUNT,
        0,
        NVDAX_STRATEGY,
        true,
        Vec::new(),
        Vec::new(),
    );
    let owner = world.owner.insecure_clone();
    world
        .send(&[instruction], &[&owner])
        .expect_err("a paused program must refuse a new position");

    let unwind = world.unwind_instruction(&opened, owner.pubkey(), 0, Vec::new(), Vec::new());
    world
        .send(&[unwind], &[&owner])
        .expect("a paused program must still let a position out");
    assert_eq!(world.obligation_debt(&opened.obligation), 0);
}

#[test]
fn a_retired_program_refuses_a_new_position_and_still_lets_one_out() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    world.set_sunset_as(&world.admin.insecure_clone()).unwrap();
    let config = world.config();
    assert!(config.sunset);
    assert!(config.open_paused);

    let guardian = world.guardian.insecure_clone();
    world.set_paused_as(&guardian, Some(false), None).unwrap();

    let second =
        world.position_address(&world.collateral.liquidity_mint(), &world.destination_mint);
    let instruction = world.open_position_instruction(
        second,
        &opened.tokens,
        world.collateral.raw_amount_worth_usd(POSITION_SIZE_USD),
        BORROW_AMOUNT,
        0,
        NVDAX_STRATEGY,
        true,
        Vec::new(),
        Vec::new(),
    );
    let owner = world.owner.insecure_clone();
    world
        .send(&[instruction], &[&owner])
        .expect_err("a retired program must refuse a new position even when unpaused");

    let rescue = world.rescue_instruction(&opened, owner.pubkey());
    world
        .send(&[rescue], &[&owner])
        .expect("rescue ignores the retirement flag");
}

#[test]
fn every_owner_instruction_refuses_a_stranger() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    let stranger = world.stranger.insecure_clone();
    let stranger_key = stranger.pubkey();

    let refused = vec![
        (
            "add_collateral",
            world.add_collateral_instruction(&opened, stranger_key, 1_000),
        ),
        (
            "repay",
            world.repay_instruction(&opened, stranger_key, 1_000),
        ),
        (
            "withdraw_collateral",
            world.withdraw_collateral_instruction(&opened, stranger_key, 1_000),
        ),
        (
            "set_strategy",
            world.set_strategy_instruction(&opened, stranger_key, NVDAX_STRATEGY),
        ),
        (
            "unwind",
            world.unwind_instruction(&opened, stranger_key, 0, Vec::new(), Vec::new()),
        ),
        ("rescue", world.rescue_instruction(&opened, stranger_key)),
        (
            "close_position",
            world.close_position_instruction(&opened, stranger_key),
        ),
    ];

    let collateral_before = world.obligation_collateral(&opened.obligation);
    let debt_before = world.obligation_debt(&opened.obligation);
    let usdc_before = world.token_balance(&opened.tokens.position_usdc);

    for (name, instruction) in refused {
        assert!(
            world.send(&[instruction], &[&stranger]).is_err(),
            "{name} let a stranger through"
        );
    }

    assert_eq!(
        world.obligation_collateral(&opened.obligation),
        collateral_before
    );
    assert_eq!(world.obligation_debt(&opened.obligation), debt_before);
    assert_eq!(
        world.token_balance(&opened.tokens.position_usdc),
        usdc_before
    );
}

#[test]
fn buy_destination_refuses_a_position_that_is_not_awaiting_its_swap() {
    let mut world = World::new();
    world.install_swap_program("honest_swap.so");
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
            crate::actions::honest_route_data(BORROW_AMOUNT, destination_out),
            route_accounts.clone(),
        )
        .expect("the first buy finishes the split open");

    world
        .buy_destination(
            &opened,
            1,
            crate::actions::honest_route_data(1, 1),
            route_accounts,
        )
        .expect_err("a second buy on an open position must be refused");

    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        destination_out
    );
}

#[test]
fn a_config_can_only_be_written_once() {
    let mut world = World::new();
    let stranger = world.stranger.insecure_clone();
    let treasury = world.treasury_usdc_account;
    let config_address = world.config_address;

    let instruction = solana_instruction::Instruction {
        program_id: accrue::ID,
        accounts: anchor_lang::ToAccountMetas::to_account_metas(
            &accrue::accounts::InitializeConfig {
                deployer: stranger.pubkey(),
                config: config_address,
                treasury,
                system_program: accrue::constants::SYSTEM_PROGRAM_ID,
            },
            None,
        ),
        data: anchor_lang::InstructionData::data(&accrue::instruction::InitializeConfig {
            admin: stranger.pubkey(),
            guardian: stranger.pubkey(),
            limits: default_limits(),
        }),
    };

    world
        .send(&[instruction], &[&stranger])
        .expect_err("the config is written once and never again");
    assert_eq!(world.config().admin, world.admin.pubkey());
}

#[test]
fn a_position_left_in_awaiting_swap_can_still_be_rescued() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    let owner = world.owner.insecure_clone();

    let owner_usdc_before = world.token_balance(&opened.tokens.owner_usdc);
    let instruction = world.rescue_instruction(&opened, owner.pubkey());
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "rescue reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);
    assert_eq!(
        world.token_balance(&opened.tokens.owner_usdc),
        owner_usdc_before + BORROW_AMOUNT
    );
    assert!(world.token_balance(&opened.tokens.owner_collateral) > 0);

    let account = world.svm.get_account(&opened.address).unwrap();
    let position = <accrue::state::Position as anchor_lang::AccountDeserialize>::try_deserialize(
        &mut account.data.as_slice(),
    )
    .unwrap();
    assert_eq!(position.state, PositionState::Closing);
}
