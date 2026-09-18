use accrue::state::{CollateralEntry, DestinationEntry, PositionState};
use solana_signer::Signer;

use crate::actions::OpenedPosition;
use crate::world::{World, ONYC_SCOPE_FEED_INDEX};

const POSITION_SIZE_USD: u64 = 20;
const BORROW_AMOUNT: u64 = 4_000_000;
const TOP_UP_BORROW: u64 = 2_000_000;

fn a_guarded_position() -> (World, OpenedPosition) {
    let mut world = World::new();
    world.install_swap_program("honest_swap.so");
    let destination_out = world.destination_worth_of(BORROW_AMOUNT);
    let opened = world.open_a_guarded_position_borrowing(BORROW_AMOUNT, destination_out);
    (world, opened)
}

fn stock_worth(world: &World, whole_dollars: u64) -> u64 {
    world.collateral.raw_amount_worth_usd(whole_dollars)
}

// A top up with the swap in the same call, filled honestly at the oracle price.
fn top_up(
    world: &mut World,
    opened: &OpenedPosition,
    collateral_amount: u64,
    borrow_amount: u64,
) -> Result<(), litesvm::types::FailedTransactionMetadata> {
    let destination_out = world.destination_worth_of(borrow_amount);
    let route = world.swap_route_accounts(
        opened.address,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        None,
    );
    let owner = world.owner.insecure_clone();
    let instruction = world.top_up_instruction(
        opened,
        owner.pubkey(),
        collateral_amount,
        borrow_amount,
        destination_out,
        false,
        world.an_honest_fill(borrow_amount, destination_out),
        route,
    );
    world.send(&[instruction], &[&owner]).map(|_| ())
}

#[test]
fn the_worked_example_from_the_program_document() {
    let (mut world, opened) = a_guarded_position();

    let before = world.position(&opened.address);
    let collateral_before = world.obligation_collateral(&opened.obligation);
    let destination_before = world.token_balance(&opened.tokens.position_destination);
    let strategy_before = before.strategy;

    let added = stock_worth(&world, POSITION_SIZE_USD / 2);
    top_up(&mut world, &opened, added, TOP_UP_BORROW).expect("a top up on an open position");

    let after = world.position(&opened.address);
    // Half as much stock again, half as much borrowed again, and the same guard on both.
    assert!(world.obligation_collateral(&opened.obligation) > collateral_before);
    assert!(world.token_balance(&opened.tokens.position_destination) > destination_before);
    assert_eq!(
        after.usdc_borrowed_total,
        before.usdc_borrowed_total + TOP_UP_BORROW
    );
    assert_eq!(after.usdc_from_sales_total, before.usdc_from_sales_total);
    assert_eq!(after.strategy, strategy_before);
    assert_eq!(after.state, PositionState::Open);
    assert_eq!(after.protect_count, before.protect_count);
}

#[test]
fn the_position_ends_at_or_below_the_target_it_already_had() {
    let (mut world, opened) = a_guarded_position();
    let added = stock_worth(&world, POSITION_SIZE_USD);

    top_up(&mut world, &opened, added, TOP_UP_BORROW).expect("a top up within target");

    let target = world.position(&opened.address).strategy.target_ltv_bps;
    assert!(world.obligation_loan_to_value_bps(&opened.obligation) <= target);
}

#[test]
fn a_borrow_that_lands_above_target_reverts() {
    let (mut world, opened) = a_guarded_position();
    let barely_any_stock = stock_worth(&world, 1);

    top_up(&mut world, &opened, barely_any_stock, BORROW_AMOUNT * 4)
        .expect_err("a borrow past the position's own target must revert");
}

#[test]
fn a_top_up_that_crosses_the_largest_position_reverts() {
    let (mut world, opened) = a_guarded_position();
    world
        .update_config(accrue::instructions::ConfigUpdate {
            limits: Some(accrue::state::ConfigLimits {
                max_position_usd: POSITION_SIZE_USD,
                ..world.config().limits()
            }),
            ..Default::default()
        })
        .expect("the admin may lower the largest position");

    let added = stock_worth(&world, POSITION_SIZE_USD);
    top_up(&mut world, &opened, added, TOP_UP_BORROW)
        .expect_err("a position past the largest allowed must revert");
}

#[test]
fn a_signer_who_is_not_the_owner_is_refused_before_any_token_moves() {
    let (mut world, opened) = a_guarded_position();
    let stranger = world.stranger.insecure_clone();
    let collateral_before = world.obligation_collateral(&opened.obligation);

    let added = stock_worth(&world, 1);
    let destination_out = world.destination_worth_of(TOP_UP_BORROW);
    let route = world.swap_route_accounts(
        opened.address,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        None,
    );
    let instruction = world.top_up_instruction(
        &opened,
        stranger.pubkey(),
        added,
        TOP_UP_BORROW,
        destination_out,
        false,
        world.an_honest_fill(TOP_UP_BORROW, destination_out),
        route,
    );

    world
        .send(&[instruction], &[&stranger])
        .expect_err("a stranger must not grow somebody else's position");
    assert_eq!(
        world.obligation_collateral(&opened.obligation),
        collateral_before
    );
}

#[test]
fn a_stock_taken_off_the_list_after_the_position_opened_takes_no_new_money() {
    let (mut world, opened) = a_guarded_position();
    let entry = CollateralEntry {
        mint: world.collateral.liquidity_mint(),
        reserve: world.collateral.address,
        token_program: world.collateral.token_program(),
        scope_price_account: world.scope_prices,
        scope_feed_index: world.collateral.snapshot.scope_feed_index,
        enabled: false,
    };
    world
        .update_config(accrue::instructions::ConfigUpdate {
            collateral: Some(entry),
            ..Default::default()
        })
        .expect("the admin may take a stock off the list");

    let added = stock_worth(&world, 1);
    top_up(&mut world, &opened, added, TOP_UP_BORROW)
        .expect_err("a stock off the list must take no new money");
}

#[test]
fn a_yield_token_taken_off_the_list_after_the_position_opened_takes_no_new_money() {
    let (mut world, opened) = a_guarded_position();
    let entry = DestinationEntry {
        mint: world.destination_mint,
        token_program: world.destination_token_program,
        scope_price_account: world.scope_prices,
        scope_feed_index: ONYC_SCOPE_FEED_INDEX,
        enabled: false,
    };
    world
        .update_config(accrue::instructions::ConfigUpdate {
            destination: Some(entry),
            ..Default::default()
        })
        .expect("the admin may take a yield token off the list");

    let added = stock_worth(&world, 1);
    top_up(&mut world, &opened, added, TOP_UP_BORROW)
        .expect_err("a yield token off the list must take no new money");
}

#[test]
fn nothing_added_and_nothing_borrowed_are_both_refused() {
    let (mut world, opened) = a_guarded_position();
    let added = stock_worth(&world, 1);

    top_up(&mut world, &opened, 0, TOP_UP_BORROW).expect_err("nothing added must revert");
    top_up(&mut world, &opened, added, 0).expect_err("nothing borrowed must revert");
}

#[test]
fn a_swap_in_the_same_call_with_no_minimum_is_refused() {
    let (mut world, opened) = a_guarded_position();
    let added = stock_worth(&world, 1);
    let route = world.swap_route_accounts(
        opened.address,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        accrue::constants::TOKEN_PROGRAM_ID,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        None,
    );
    let owner = world.owner.insecure_clone();
    let instruction = world.top_up_instruction(
        &opened,
        owner.pubkey(),
        added,
        TOP_UP_BORROW,
        0,
        false,
        world.an_honest_fill(TOP_UP_BORROW, 1),
        route,
    );

    world
        .send(&[instruction], &[&owner])
        .expect_err("a swap with no minimum must revert");
}

#[test]
fn paused_opens_refuse_a_top_up_because_it_is_a_new_borrow() {
    let (mut world, opened) = a_guarded_position();
    let guardian = world.guardian.insecure_clone();
    world
        .set_paused_as(&guardian, Some(true), None)
        .expect("the guardian may pause opens");

    let added = stock_worth(&world, 1);
    top_up(&mut world, &opened, added, TOP_UP_BORROW)
        .expect_err("a paused program must take no new borrow");
}

#[test]
fn a_sunset_program_refuses_a_top_up() {
    let (mut world, opened) = a_guarded_position();
    let admin = world.admin.insecure_clone();
    world.set_sunset_as(&admin).expect("the admin may sunset");

    let added = stock_worth(&world, 1);
    top_up(&mut world, &opened, added, TOP_UP_BORROW)
        .expect_err("a retiring program must take no new borrow");
}

#[test]
fn a_position_waiting_for_its_swap_refuses_a_top_up() {
    let mut world = World::new();
    world.install_swap_program("honest_swap.so");
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    let added = stock_worth(&world, 1);

    top_up(&mut world, &opened, added, TOP_UP_BORROW)
        .expect_err("a position part way through an open must not be grown");
}

#[test]
fn the_usdc_stays_in_the_position_when_the_swap_is_left_for_later() {
    let (mut world, opened) = a_guarded_position();
    let added = stock_worth(&world, 1);
    let owner = world.owner.insecure_clone();
    let instruction = world.top_up_instruction(
        &opened,
        owner.pubkey(),
        added,
        TOP_UP_BORROW,
        0,
        true,
        Vec::new(),
        Vec::new(),
    );

    world
        .send(&[instruction], &[&owner])
        .expect("a split top up leaves the usdc in the position");

    let position = world.position(&opened.address);
    assert_eq!(position.state, PositionState::AwaitingSwap);
    assert_eq!(
        world.token_balance(&opened.tokens.position_usdc),
        TOP_UP_BORROW
    );
}

// The swap inside a top up is the same swap as an open, so the same hostile routes are aimed at it.
mod a_hostile_route {
    use accrue::constants::TOKEN_PROGRAM_ID;
    use solana_address::Address;
    use solana_signer::Signer;

    use super::{a_guarded_position, stock_worth, TOP_UP_BORROW};
    use crate::actions::hostile_route_data;

    const ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING: u8 = 0;
    const ATTACK_PAY_LESS_THAN_THE_MINIMUM: u8 = 1;
    const ATTACK_SEND_THE_OUTPUT_SOMEWHERE_ELSE: u8 = 2;
    const ATTACK_DRAIN_AN_ACCOUNT_IT_WAS_HANDED: u8 = 3;
    const ATTACK_CLOSE_AN_ACCOUNT_IT_WAS_HANDED: u8 = 4;
    const ATTACK_APPROVE_ITSELF_AS_DELEGATE: u8 = 6;
    const ATTACK_TAKE_THE_OWNER_AUTHORITY: u8 = 7;
    const ATTACK_SET_A_CLOSE_AUTHORITY: u8 = 8;

    fn refused(attack: u8, extra: Option<Address>, why: &str) {
        refused_paying(attack, extra, None, why);
    }

    // What the route really pays, when the attack is to pay less than it was asked for.
    fn refused_paying(attack: u8, extra: Option<Address>, pays: Option<u64>, why: &str) {
        let (mut world, opened) = a_guarded_position();
        world.install_swap_program("hostile_swap.so");

        let collateral_before = world.obligation_collateral(&opened.obligation);
        let destination_before = world.token_balance(&opened.tokens.position_destination);
        let usdc_before = world.token_balance(&opened.tokens.position_usdc);

        let destination_out = world.destination_worth_of(TOP_UP_BORROW);
        let route = world.swap_route_accounts(
            opened.address,
            opened.tokens.position_usdc,
            world.borrow.liquidity_mint(),
            TOKEN_PROGRAM_ID,
            opened.tokens.position_destination,
            world.destination_mint,
            world.destination_token_program,
            extra,
        );
        let owner = world.owner.insecure_clone();
        let instruction = world.top_up_instruction(
            &opened,
            owner.pubkey(),
            stock_worth(&world, 1),
            TOP_UP_BORROW,
            destination_out,
            false,
            hostile_route_data(attack, TOP_UP_BORROW, pays.unwrap_or(destination_out)),
            route,
        );

        world.send(&[instruction], &[&owner]).expect_err(why);
        assert_eq!(
            world.obligation_collateral(&opened.obligation),
            collateral_before,
            "{why}: the obligation moved"
        );
        assert_eq!(
            world.token_balance(&opened.tokens.position_destination),
            destination_before,
            "{why}: the yield token moved"
        );
        assert_eq!(
            world.token_balance(&opened.tokens.position_usdc),
            usdc_before,
            "{why}: the usdc moved"
        );
    }

    #[test]
    fn that_keeps_the_input_and_pays_nothing_reverts() {
        refused(
            ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING,
            None,
            "a route that pays nothing must revert",
        );
    }

    #[test]
    fn that_pays_less_than_the_minimum_reverts() {
        refused_paying(
            ATTACK_PAY_LESS_THAN_THE_MINIMUM,
            None,
            Some(1_000),
            "a route that pays under the minimum must revert",
        );
    }

    #[test]
    fn that_sends_the_output_somewhere_else_reverts() {
        let (world, _) = a_guarded_position();
        let thief = world.stranger.pubkey();
        refused(
            ATTACK_SEND_THE_OUTPUT_SOMEWHERE_ELSE,
            Some(thief),
            "a route that pays somebody else must revert",
        );
    }

    #[test]
    fn that_drains_an_account_it_was_handed_reverts() {
        refused(
            ATTACK_DRAIN_AN_ACCOUNT_IT_WAS_HANDED,
            None,
            "a route that drains an account must revert",
        );
    }

    #[test]
    fn that_closes_an_account_it_was_handed_reverts() {
        refused(
            ATTACK_CLOSE_AN_ACCOUNT_IT_WAS_HANDED,
            None,
            "a route that closes an account must revert",
        );
    }

    #[test]
    fn that_approves_itself_as_delegate_reverts() {
        refused(
            ATTACK_APPROVE_ITSELF_AS_DELEGATE,
            None,
            "a route that takes a delegate must revert",
        );
    }

    #[test]
    fn that_takes_the_owner_authority_reverts() {
        refused(
            ATTACK_TAKE_THE_OWNER_AUTHORITY,
            None,
            "a route that takes the owner authority must revert",
        );
    }

    #[test]
    fn that_sets_a_close_authority_reverts() {
        refused(
            ATTACK_SET_A_CLOSE_AUTHORITY,
            None,
            "a route that sets a close authority must revert",
        );
    }
}

// Every account the position owns is derived, so handing the instruction somebody else's is refused.
mod a_substituted_account {
    use accrue::constants::TOKEN_PROGRAM_ID;
    use solana_address::Address;
    use solana_signer::Signer;

    use super::{a_guarded_position, stock_worth, TOP_UP_BORROW};

    fn refused_when(pick: impl Fn(&crate::actions::OpenedPosition) -> Address, why: &str) {
        let (mut world, opened) = a_guarded_position();
        let collateral_before = world.obligation_collateral(&opened.obligation);
        let theirs = pick(&opened);
        let stranger = world.stranger.pubkey();
        let mint = world.token_account_mint(&theirs);
        let program = world.token_account_program(&theirs);
        let somebody_elses = world.create_token_account(mint, stranger, 0, program);

        let owner = world.owner.insecure_clone();
        let destination_out = world.destination_worth_of(TOP_UP_BORROW);
        let route = world.swap_route_accounts(
            opened.address,
            opened.tokens.position_usdc,
            world.borrow.liquidity_mint(),
            TOKEN_PROGRAM_ID,
            opened.tokens.position_destination,
            world.destination_mint,
            world.destination_token_program,
            None,
        );
        let mut instruction = world.top_up_instruction(
            &opened,
            owner.pubkey(),
            stock_worth(&world, 1),
            TOP_UP_BORROW,
            destination_out,
            false,
            world.an_honest_fill(TOP_UP_BORROW, destination_out),
            route,
        );
        for account in instruction.accounts.iter_mut() {
            if account.pubkey == theirs {
                account.pubkey = somebody_elses;
            }
        }

        world.send(&[instruction], &[&owner]).expect_err(why);
        assert_eq!(
            world.obligation_collateral(&opened.obligation),
            collateral_before,
            "{why}: the obligation moved anyway"
        );
    }

    #[test]
    fn for_the_stock_the_position_holds_is_refused() {
        refused_when(
            |opened| opened.tokens.position_collateral,
            "another stock account must be refused",
        );
    }

    #[test]
    fn for_the_usdc_the_position_holds_is_refused() {
        refused_when(
            |opened| opened.tokens.position_usdc,
            "another usdc account must be refused",
        );
    }

    #[test]
    fn for_the_yield_token_the_position_holds_is_refused() {
        refused_when(
            |opened| opened.tokens.position_destination,
            "another yield token account must be refused",
        );
    }

    #[test]
    fn for_the_stock_the_owner_pays_from_is_refused() {
        refused_when(
            |opened| opened.tokens.owner_collateral,
            "another wallet's stock account must be refused",
        );
    }
}

// Growing a position borrows more, and borrowing is not profit, so the fee base must not move.
#[test]
fn a_top_up_then_an_unwind_charges_the_fee_only_on_real_profit() {
    let (mut world, opened) = a_guarded_position();
    let added = stock_worth(&world, POSITION_SIZE_USD / 2);
    top_up(&mut world, &opened, added, TOP_UP_BORROW).expect("a top up on an open position");

    let borrowed = world.position(&opened.address).usdc_borrowed_total;
    assert_eq!(borrowed, BORROW_AMOUNT + TOP_UP_BORROW);
    assert_eq!(world.position(&opened.address).usdc_from_sales_total, 0);

    // The sale covers every dollar borrowed and a little more, and only that little is profit.
    let profit = 200_000;
    let sale_proceeds = borrowed + profit;
    let destination_held = world.token_balance(&opened.tokens.position_destination);
    world.set_token_account(
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        opened.address,
        0,
        accrue::constants::TOKEN_PROGRAM_ID,
    );
    let route = world.swap_route_accounts(
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
        crate::actions::honest_route_data(destination_held, sale_proceeds),
        route,
    );
    world
        .send(&[instruction], &[&owner])
        .unwrap_or_else(|failure| {
            panic!(
                "unwind reverted: {:?} {:#?}",
                failure.err, failure.meta.logs
            )
        });

    let position = world.position(&opened.address);
    let charged = world.token_balance(&world.treasury_usdc_account);
    let expected = (position.usdc_from_sales_total - position.usdc_repaid_total) / 10;
    assert_eq!(
        charged, expected,
        "the fee is charged on what the sales raised above everything repaid, not on what was borrowed"
    );
    assert!(
        charged < sale_proceeds / 10,
        "charging on the whole sale would have taken {} rather than {charged}",
        sale_proceeds / 10
    );
}
