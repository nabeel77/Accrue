use accrue::constants::{JUPITER_V6_PROGRAM_ID, KAMINO_FARMS_PROGRAM_ID, TOKEN_PROGRAM_ID};
use accrue::kamino::KAMINO_LEND_PROGRAM_ID;
use solana_address::Address;
use solana_instruction::AccountMeta;
use solana_signer::Signer;

use crate::actions::{hostile_route_data, OpenedPosition};
use crate::world::World;

const HOSTILE_SWAP_PROGRAM: &str = "hostile_swap.so";
const BORROW_AMOUNT: u64 = 4_000_000;
const POSITION_SIZE_USD: u64 = 20;

const ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING: u8 = 0;
const ATTACK_PAY_LESS_THAN_THE_MINIMUM: u8 = 1;
const ATTACK_SEND_THE_OUTPUT_SOMEWHERE_ELSE: u8 = 2;
const ATTACK_DRAIN_AN_ACCOUNT_IT_WAS_HANDED: u8 = 3;
const ATTACK_CLOSE_AN_ACCOUNT_IT_WAS_HANDED: u8 = 4;
use crate::actions::ATTACK_HONEST_FILL;
const ATTACK_APPROVE_ITSELF_AS_DELEGATE: u8 = 6;
const ATTACK_TAKE_THE_OWNER_AUTHORITY: u8 = 7;
const ATTACK_SET_A_CLOSE_AUTHORITY: u8 = 8;

struct Untouched {
    usdc: u64,
    destination: u64,
    collateral: u64,
    obligation_collateral: u64,
    obligation_debt: u128,
    position_lamports: u64,
    authorities: [TokenAccountAuthorities; 3],
}

#[derive(Debug, PartialEq, Eq)]
struct TokenAccountAuthorities {
    owner: Address,
    delegate: Option<Address>,
    close_authority: Option<Address>,
}

fn read_authorities(world: &World, token_account: &Address) -> TokenAccountAuthorities {
    let account = world.svm.get_account(token_account).unwrap();
    let address_at = |offset: usize| {
        let mut buffer = [0u8; 32];
        buffer.copy_from_slice(&account.data[offset..offset + 32]);
        Address::from(buffer)
    };
    let option_at = |tag: usize, value: usize| {
        let mut buffer = [0u8; 4];
        buffer.copy_from_slice(&account.data[tag..tag + 4]);
        if u32::from_le_bytes(buffer) == 0 {
            None
        } else {
            Some(address_at(value))
        }
    };
    TokenAccountAuthorities {
        owner: address_at(32),
        delegate: option_at(72, 76),
        close_authority: option_at(129, 133),
    }
}

impl Untouched {
    fn read(world: &World, opened: &OpenedPosition) -> Self {
        Self {
            usdc: world.token_balance(&opened.tokens.position_usdc),
            destination: world.token_balance(&opened.tokens.position_destination),
            collateral: world.token_balance(&opened.tokens.position_collateral),
            obligation_collateral: world.obligation_collateral(&opened.obligation),
            obligation_debt: world.obligation_debt(&opened.obligation),
            position_lamports: world.lamports_of(&opened.address),
            authorities: [
                read_authorities(world, &opened.tokens.position_collateral),
                read_authorities(world, &opened.tokens.position_usdc),
                read_authorities(world, &opened.tokens.position_destination),
            ],
        }
    }

    fn assert_still_true(&self, world: &World, opened: &OpenedPosition, attack: &str) {
        assert_eq!(
            world.token_balance(&opened.tokens.position_usdc),
            self.usdc,
            "{attack} moved USDC"
        );
        assert_eq!(
            world.token_balance(&opened.tokens.position_destination),
            self.destination,
            "{attack} moved the destination token"
        );
        assert_eq!(
            world.token_balance(&opened.tokens.position_collateral),
            self.collateral,
            "{attack} moved the stock"
        );
        assert_eq!(
            world.obligation_collateral(&opened.obligation),
            self.obligation_collateral,
            "{attack} moved the obligation collateral"
        );
        assert_eq!(
            world.obligation_debt(&opened.obligation),
            self.obligation_debt,
            "{attack} moved the debt"
        );
        assert_eq!(
            world.lamports_of(&opened.address),
            self.position_lamports,
            "{attack} moved lamports out of the position"
        );

        let now = [
            read_authorities(world, &opened.tokens.position_collateral),
            read_authorities(world, &opened.tokens.position_usdc),
            read_authorities(world, &opened.tokens.position_destination),
        ];
        assert_eq!(
            now, self.authorities,
            "{attack} changed an authority on a position token account"
        );
        for authorities in &now {
            assert_eq!(authorities.owner, opened.address);
            assert_eq!(authorities.delegate, None);
            assert_eq!(authorities.close_authority, None);
        }
    }
}

fn a_position_with_a_hostile_router() -> (World, OpenedPosition) {
    let mut world = World::new();
    world.install_swap_program(HOSTILE_SWAP_PROGRAM);
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);
    (world, opened)
}

fn buying_route(
    world: &World,
    opened: &OpenedPosition,
    extra: Option<Address>,
) -> Vec<AccountMeta> {
    world.swap_route_accounts(
        opened.address,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        TOKEN_PROGRAM_ID,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        extra,
    )
}

#[test]
fn a_route_that_keeps_the_input_and_pays_nothing_reverts() {
    let (mut world, opened) = a_position_with_a_hostile_router();
    let before = Untouched::read(&world, &opened);
    let route = buying_route(&world, &opened, None);

    world
        .buy_destination(
            &opened,
            3_900_000_000,
            hostile_route_data(ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING, BORROW_AMOUNT, 0),
            route,
        )
        .expect_err("a route that pays nothing must revert");
    before.assert_still_true(&world, &opened, "keeping the input");
}

#[test]
fn a_route_that_pays_less_than_the_minimum_reverts() {
    let (mut world, opened) = a_position_with_a_hostile_router();
    let before = Untouched::read(&world, &opened);
    let route = buying_route(&world, &opened, None);

    world
        .buy_destination(
            &opened,
            3_900_000_000,
            hostile_route_data(ATTACK_PAY_LESS_THAN_THE_MINIMUM, BORROW_AMOUNT, 1_000),
            route,
        )
        .expect_err("a route that pays under the minimum must revert");
    before.assert_still_true(&world, &opened, "paying under the minimum");
}

#[test]
fn a_route_that_sends_the_output_somewhere_else_reverts() {
    let (mut world, opened) = a_position_with_a_hostile_router();
    let thief = world.create_token_account(
        world.destination_mint,
        world.stranger.pubkey(),
        0,
        world.destination_token_program,
    );
    let before = Untouched::read(&world, &opened);
    let route = buying_route(&world, &opened, Some(thief));

    world
        .buy_destination(
            &opened,
            3_900_000_000,
            hostile_route_data(
                ATTACK_SEND_THE_OUTPUT_SOMEWHERE_ELSE,
                BORROW_AMOUNT,
                3_900_000_000,
            ),
            route,
        )
        .expect_err("a route that pays a stranger must revert");

    before.assert_still_true(&world, &opened, "paying a stranger");
    assert_eq!(world.token_balance(&thief), 0);
}

#[test]
fn a_route_that_closes_the_account_it_was_handed_reverts() {
    let (mut world, opened) = a_position_with_a_hostile_router();
    let thief = world.stranger.pubkey();
    let before = Untouched::read(&world, &opened);
    let route = buying_route(&world, &opened, Some(thief));

    world
        .buy_destination(
            &opened,
            3_900_000_000,
            hostile_route_data(
                ATTACK_CLOSE_AN_ACCOUNT_IT_WAS_HANDED,
                BORROW_AMOUNT,
                3_900_000_000,
            ),
            route,
        )
        .expect_err("a route that closes a position account must revert");

    before.assert_still_true(&world, &opened, "closing a position account");
    assert!(world
        .svm
        .get_account(&opened.tokens.position_usdc)
        .is_some_and(|account| !account.data.is_empty()));
}

#[test]
fn a_route_handed_the_stock_account_is_refused_before_it_runs() {
    let (mut world, opened) = a_position_with_a_hostile_router();
    let before = Untouched::read(&world, &opened);
    let route = buying_route(&world, &opened, Some(opened.tokens.position_collateral));

    world
        .buy_destination(
            &opened,
            3_900_000_000,
            hostile_route_data(ATTACK_DRAIN_AN_ACCOUNT_IT_WAS_HANDED, BORROW_AMOUNT, 0),
            route,
        )
        .expect_err("a route must never receive the stock account");
    before.assert_still_true(&world, &opened, "handing over the stock account");
}

#[test]
fn a_route_handed_a_lending_market_account_is_refused_before_it_runs() {
    let (mut world, opened) = a_position_with_a_hostile_router();
    let before = Untouched::read(&world, &opened);

    for forbidden in [
        opened.obligation,
        world.collateral.address,
        world.market,
        KAMINO_LEND_PROGRAM_ID,
        KAMINO_FARMS_PROGRAM_ID,
        world.config_address,
        accrue::ID,
    ] {
        let route = buying_route(&world, &opened, Some(forbidden));
        world
            .buy_destination(
                &opened,
                3_900_000_000,
                hostile_route_data(ATTACK_HONEST_FILL, BORROW_AMOUNT, 3_900_000_000),
                route,
            )
            .err()
            .unwrap_or_else(|| panic!("the route was handed {forbidden} and ran"));
        before.assert_still_true(&world, &opened, "handing over a forbidden account");
    }
}

fn assert_the_authority_trick_reverts(mode: u8, expected_error: &str, attack: &str) {
    let (mut world, opened) = a_position_with_a_hostile_router();
    let thief = world.stranger.pubkey();
    let before = Untouched::read(&world, &opened);
    let route = buying_route(&world, &opened, Some(thief));
    let destination_out = 3_900_000_000;

    let failure = world
        .buy_destination(
            &opened,
            destination_out,
            hostile_route_data(mode, BORROW_AMOUNT, destination_out),
            route,
        )
        .expect_err("a route that pays in full and still takes an authority must revert");
    let logs = failure.meta.logs.join("\n");
    assert!(
        logs.contains(&format!("Program {JUPITER_V6_PROGRAM_ID} success")),
        "{attack} never got as far as paying in full, so the revert proves nothing:\n{logs}"
    );
    assert!(
        logs.contains(expected_error),
        "{attack} reverted for the wrong reason:\n{logs}"
    );

    before.assert_still_true(&world, &opened, attack);
}

#[test]
fn a_route_that_approves_itself_as_delegate_reverts_even_when_it_pays_in_full() {
    assert_the_authority_trick_reverts(
        ATTACK_APPROVE_ITSELF_AS_DELEGATE,
        "PositionTokenAccountHasADelegate",
        "approving itself as delegate",
    );
}

#[test]
fn a_route_that_takes_the_owner_authority_reverts_even_when_it_pays_in_full() {
    assert_the_authority_trick_reverts(
        ATTACK_TAKE_THE_OWNER_AUTHORITY,
        "PositionTokenAccountOwnerChanged",
        "taking the owner authority",
    );
}

#[test]
fn a_route_that_sets_a_close_authority_reverts_even_when_it_pays_in_full() {
    assert_the_authority_trick_reverts(
        ATTACK_SET_A_CLOSE_AUTHORITY,
        "PositionTokenAccountHasACloseAuthority",
        "setting a close authority",
    );
}

#[test]
fn an_honest_fill_through_the_same_program_still_works() {
    let (mut world, opened) = a_position_with_a_hostile_router();
    let route = buying_route(&world, &opened, None);
    let destination_out = 3_900_000_000;

    world
        .buy_destination(
            &opened,
            destination_out,
            hostile_route_data(ATTACK_HONEST_FILL, BORROW_AMOUNT, destination_out),
            route,
        )
        .expect("an honest fill must be allowed, or the attacks above prove nothing");

    assert_eq!(world.token_balance(&opened.tokens.position_usdc), 0);
    assert_eq!(
        world.token_balance(&opened.tokens.position_destination),
        destination_out
    );
}

#[test]
fn a_hostile_route_on_unwind_cannot_take_the_destination_token() {
    let mut world = World::new();
    world.install_swap_program(HOSTILE_SWAP_PROGRAM);
    let opened = world.open_a_position_awaiting_its_swap(POSITION_SIZE_USD, BORROW_AMOUNT);

    let destination_held = 4_000_000_000;
    world.set_token_account(
        opened.tokens.position_destination,
        world.destination_mint,
        opened.address,
        destination_held,
        world.destination_token_program,
    );
    let before = Untouched::read(&world, &opened);

    let route = world.swap_route_accounts(
        opened.address,
        opened.tokens.position_destination,
        world.destination_mint,
        world.destination_token_program,
        opened.tokens.position_usdc,
        world.borrow.liquidity_mint(),
        TOKEN_PROGRAM_ID,
        None,
    );
    let owner = world.owner.insecure_clone();
    let instruction = world.unwind_instruction(
        &opened,
        owner.pubkey(),
        BORROW_AMOUNT,
        hostile_route_data(ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING, destination_held, 0),
        route,
    );

    world
        .send(&[instruction], &[&owner])
        .expect_err("an unwind whose route pays nothing must revert");
    before.assert_still_true(&world, &opened, "an unwind route that pays nothing");
}
