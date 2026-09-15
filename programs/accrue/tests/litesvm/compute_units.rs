use solana_signer::Signer;

use crate::actions::{honest_route_data, NVDAX_STRATEGY};
use crate::world::World;

const HONEST_SWAP_PROGRAM: &str = "honest_swap.so";
const BORROW_AMOUNT: u64 = 4_000_000;
const POSITION_SIZE_USD: u64 = 20;
const DESTINATION_BOUGHT: u64 = 3_900_000_000;
const VERSION_ONE_COMPUTE_CEILING: u64 = 1_400_000;

#[test]
fn every_owner_instruction_reports_what_it_costs_to_run() {
    let mut world = World::new();
    world.install_swap_program(HONEST_SWAP_PROGRAM);

    let collateral_mint = world.collateral.liquidity_mint();
    let position = world.position_address(&collateral_mint, &world.destination_mint);
    let stock_amount = world.collateral.raw_amount_worth_usd(POSITION_SIZE_USD);
    let tokens = world.fund_owner_and_open_token_accounts(position, stock_amount);
    let owner = world.owner.insecure_clone();

    let route = world.swap_route_accounts(
        position,
        tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        None,
    );
    let open = world.open_position_instruction(
        position,
        &tokens,
        stock_amount,
        BORROW_AMOUNT,
        DESTINATION_BOUGHT,
        NVDAX_STRATEGY,
        false,
        honest_route_data(BORROW_AMOUNT, DESTINATION_BOUGHT),
        route,
    );
    let mut costs = vec![(
        "open_position, one instruction",
        world
            .send(&[open], &[&owner])
            .unwrap()
            .compute_units_consumed,
    )];

    let opened = world.opened_position(position, tokens);

    world.set_token_account(
        opened.tokens.owner_usdc,
        world.borrow.liquidity_mint(),
        owner.pubkey(),
        BORROW_AMOUNT,
        accrue::constants::TOKEN_PROGRAM_ID,
    );

    let more_stock = world.collateral.raw_amount_worth_usd(5);
    let add = world.add_collateral_instruction(&opened, owner.pubkey(), more_stock);
    costs.push((
        "add_collateral",
        world
            .send(&[add], &[&owner])
            .unwrap()
            .compute_units_consumed,
    ));

    let repay = world.repay_instruction(&opened, owner.pubkey(), 1_000_000);
    costs.push((
        "repay",
        world
            .send(&[repay], &[&owner])
            .unwrap()
            .compute_units_consumed,
    ));

    let deposited = world.obligation_collateral(&opened.obligation);
    let withdraw = world.withdraw_collateral_instruction(&opened, owner.pubkey(), deposited / 20);
    costs.push((
        "withdraw_collateral",
        world
            .send(&[withdraw], &[&owner])
            .unwrap()
            .compute_units_consumed,
    ));

    let set_strategy = world.set_strategy_instruction(&opened, owner.pubkey(), NVDAX_STRATEGY);
    costs.push((
        "set_strategy",
        world
            .send(&[set_strategy], &[&owner])
            .unwrap()
            .compute_units_consumed,
    ));

    let selling = world.swap_route_accounts(
        opened.address,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        None,
    );
    let held = world.token_balance(&opened.tokens.position_destination);
    let proceeds = 5_000_000;
    let unwind = world.unwind_instruction(
        &opened,
        owner.pubkey(),
        proceeds,
        honest_route_data(held, proceeds),
        selling,
    );
    costs.push((
        "unwind with a sale",
        world
            .send(&[unwind], &[&owner])
            .unwrap()
            .compute_units_consumed,
    ));

    let close = world.close_position_instruction(&opened, owner.pubkey());
    costs.push((
        "close_position",
        world
            .send(&[close], &[&owner])
            .unwrap()
            .compute_units_consumed,
    ));

    for (name, units) in &costs {
        println!("{name}: {units} compute units");
        assert!(
            *units < VERSION_ONE_COMPUTE_CEILING,
            "{name} costs more than a transaction may spend"
        );
    }
}

#[test]
fn rescue_reports_what_it_costs_to_run() {
    let mut world = World::new();
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    let owner = world.owner.insecure_clone();

    let rescue = world.rescue_instruction(&opened, owner.pubkey());
    let units = world
        .send(&[rescue], &[&owner])
        .unwrap()
        .compute_units_consumed;
    println!("rescue: {units} compute units");
    assert!(units < VERSION_ONE_COMPUTE_CEILING);
}
