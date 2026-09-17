use anchor_lang::{AccountDeserialize, Discriminator, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use price_feed::{PriceUpdate, ADMIN_SEED, ORACLE_PRICES_DISCRIMINATOR, ORACLE_PRICES_LEN};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const SYSTEM_PROGRAM: solana_address::Address = solana_address::Address::new_from_array([0u8; 32]);

struct World {
    svm: LiteSVM,
    admin: Keypair,
    prices: Keypair,
}

fn program_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/deploy/price_feed.so")
}

fn admin_record(prices: &solana_address::Address) -> solana_address::Address {
    solana_address::Address::find_program_address(&[ADMIN_SEED, prices.as_ref()], &price_feed::ID).0
}

fn new_world() -> World {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(price_feed::ID, program_path())
        .expect("the price feed program is built into target/deploy");
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    World {
        svm,
        admin,
        prices: Keypair::new(),
    }
}

fn send(
    world: &mut World,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> Result<(), String> {
    let payer = world.admin.pubkey();
    let message = Message::new(instructions, Some(&payer));
    let mut all = vec![&world.admin];
    all.extend_from_slice(signers);
    let transaction = Transaction::new(&all, message, world.svm.latest_blockhash());
    world
        .svm
        .send_transaction(transaction)
        .map(|_| ())
        .map_err(|failure| format!("{:?}", failure.meta.logs))
}

fn allocate_the_prices_account(world: &World) -> Instruction {
    let lamports = world
        .svm
        .minimum_balance_for_rent_exemption(ORACLE_PRICES_LEN);
    let mut data = vec![0u8];
    data.extend_from_slice(&[0u8; 3]);
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&(ORACLE_PRICES_LEN as u64).to_le_bytes());
    data.extend_from_slice(price_feed::ID.as_ref());
    Instruction {
        program_id: SYSTEM_PROGRAM,
        accounts: vec![
            solana_instruction::AccountMeta::new(world.admin.pubkey(), true),
            solana_instruction::AccountMeta::new(world.prices.pubkey(), true),
        ],
        data,
    }
}

fn initialize(world: &World) -> Instruction {
    Instruction {
        program_id: price_feed::ID,
        accounts: price_feed::accounts::Initialize {
            admin: world.admin.pubkey(),
            prices: world.prices.pubkey(),
            prices_admin: admin_record(&world.prices.pubkey()),
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None),
        data: price_feed::instruction::Initialize {}.data(),
    }
}

fn set_prices(world: &World, admin: &Keypair, updates: Vec<PriceUpdate>) -> Instruction {
    Instruction {
        program_id: price_feed::ID,
        accounts: price_feed::accounts::SetPrices {
            admin: admin.pubkey(),
            prices: world.prices.pubkey(),
            prices_admin: admin_record(&world.prices.pubkey()),
        }
        .to_account_metas(None),
        data: price_feed::instruction::SetPrices { updates }.data(),
    }
}

const A_MOMENT_IN_TIME: i64 = 1_800_000_000;

fn opened_world() -> World {
    let mut world = new_world();
    let mut clock = world.svm.get_sysvar::<solana_clock::Clock>();
    clock.unix_timestamp = A_MOMENT_IN_TIME;
    world.svm.set_sysvar(&clock);
    let allocate = allocate_the_prices_account(&world);
    let initialize = initialize(&world);
    let prices = world.prices.insecure_clone();
    send(&mut world, &[allocate, initialize], &[&prices]).expect("initialize lands");
    world
}

fn read_price(world: &World, feed_index: u16) -> (u64, u64, u64, u64) {
    let account = world.svm.get_account(&world.prices.pubkey()).unwrap();
    let base = 40 + usize::from(feed_index) * 56;
    let word = |at: usize| {
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&account.data[base + at..base + at + 8]);
        u64::from_le_bytes(bytes)
    };
    (word(0), word(8), word(16), word(24))
}

#[test]
fn the_account_is_the_length_and_shape_scope_uses() {
    let world = opened_world();
    let account = world.svm.get_account(&world.prices.pubkey()).unwrap();
    assert_eq!(account.data.len(), 28_712);
    assert_eq!(&account.data[0..8], &ORACLE_PRICES_DISCRIMINATOR);
    assert_eq!(account.owner, price_feed::ID);
}

#[test]
fn the_discriminator_is_the_hash_of_the_scope_account_name() {
    assert_eq!(
        ORACLE_PRICES_DISCRIMINATOR,
        [89, 128, 118, 221, 6, 72, 180, 146]
    );
}

#[test]
fn the_admin_record_names_the_account_it_was_made_for() {
    let world = opened_world();
    let account = world
        .svm
        .get_account(&admin_record(&world.prices.pubkey()))
        .unwrap();
    assert_eq!(&account.data[0..8], price_feed::PricesAdmin::DISCRIMINATOR);
    let record = price_feed::PricesAdmin::try_deserialize(&mut &account.data[..]).unwrap();
    assert_eq!(record.admin, world.admin.pubkey());
    assert_eq!(record.prices, world.prices.pubkey());
}

#[test]
fn a_price_lands_at_the_offsets_the_program_reads() {
    let mut world = opened_world();
    let admin = world.admin.insecure_clone();
    let updates = vec![
        PriceUpdate {
            feed_index: 13,
            value: 1_000_000,
            exponent: 6,
        },
        PriceUpdate {
            feed_index: 332,
            value: 17_500_000_000,
            exponent: 8,
        },
        PriceUpdate {
            feed_index: 344,
            value: 65_000_000_000,
            exponent: 8,
        },
        PriceUpdate {
            feed_index: 350,
            value: 1_020_000,
            exponent: 6,
        },
    ];
    let instruction = set_prices(&world, &admin, updates);
    send(&mut world, &[instruction], &[]).expect("set_prices lands");

    let slot = world.svm.get_sysvar::<solana_clock::Clock>().slot;
    for (index, value, exponent) in [
        (13u16, 1_000_000u64, 6u64),
        (332, 17_500_000_000, 8),
        (344, 65_000_000_000, 8),
        (350, 1_020_000, 6),
    ] {
        let (written_value, written_exponent, written_slot, written_time) =
            read_price(&world, index);
        assert_eq!(written_value, value);
        assert_eq!(written_exponent, exponent);
        assert_eq!(written_slot, slot);
        assert_eq!(written_time, A_MOMENT_IN_TIME as u64);
    }
}

#[test]
fn a_feed_nobody_wrote_stays_zero() {
    let mut world = opened_world();
    let admin = world.admin.insecure_clone();
    let instruction = set_prices(
        &world,
        &admin,
        vec![PriceUpdate {
            feed_index: 13,
            value: 1_000_000,
            exponent: 6,
        }],
    );
    send(&mut world, &[instruction], &[]).expect("set_prices lands");
    assert_eq!(read_price(&world, 332), (0, 0, 0, 0));
}

#[test]
fn a_second_write_replaces_the_first() {
    let mut world = opened_world();
    let admin = world.admin.insecure_clone();
    for value in [17_500_000_000u64, 15_750_000_000] {
        let instruction = set_prices(
            &world,
            &admin,
            vec![PriceUpdate {
                feed_index: 332,
                value,
                exponent: 8,
            }],
        );
        send(&mut world, &[instruction], &[]).expect("set_prices lands");
        world
            .svm
            .warp_to_slot(world.svm.get_sysvar::<solana_clock::Clock>().slot + 1);
    }
    assert_eq!(read_price(&world, 332).0, 15_750_000_000);
}

#[test]
fn nobody_but_the_admin_may_write_a_price() {
    let mut world = opened_world();
    let stranger = Keypair::new();
    world
        .svm
        .airdrop(&stranger.pubkey(), 10_000_000_000)
        .unwrap();
    let instruction = set_prices(
        &world,
        &stranger,
        vec![PriceUpdate {
            feed_index: 13,
            value: 1,
            exponent: 6,
        }],
    );
    let failure =
        send(&mut world, &[instruction], &[&stranger]).expect_err("a stranger is refused");
    assert!(
        failure.contains("NotAPricesAccount") || failure.contains("ConstraintHasOne"),
        "{failure}"
    );
}

#[test]
fn a_feed_past_the_end_of_the_account_is_refused() {
    let mut world = opened_world();
    let admin = world.admin.insecure_clone();
    let instruction = set_prices(
        &world,
        &admin,
        vec![PriceUpdate {
            feed_index: 512,
            value: 1,
            exponent: 6,
        }],
    );
    let failure = send(&mut world, &[instruction], &[]).expect_err("feed 512 is past the end");
    assert!(failure.contains("FeedIndexOutOfRange"), "{failure}");
}

#[test]
fn a_price_of_zero_is_refused() {
    let mut world = opened_world();
    let admin = world.admin.insecure_clone();
    let instruction = set_prices(
        &world,
        &admin,
        vec![PriceUpdate {
            feed_index: 13,
            value: 0,
            exponent: 6,
        }],
    );
    let failure = send(&mut world, &[instruction], &[]).expect_err("zero is refused");
    assert!(failure.contains("PriceIsZero"), "{failure}");
}

#[test]
fn the_same_account_cannot_be_initialised_twice() {
    let mut world = opened_world();
    let instruction = initialize(&world);
    let failure = send(&mut world, &[instruction], &[]).expect_err("the second initialize fails");
    assert!(!failure.is_empty());
}

#[test]
fn an_account_of_the_wrong_length_is_refused() {
    let mut world = new_world();
    let lamports = world.svm.minimum_balance_for_rent_exemption(128);
    let mut data = vec![0u8, 0, 0, 0];
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&128u64.to_le_bytes());
    data.extend_from_slice(price_feed::ID.as_ref());
    let allocate = Instruction {
        program_id: SYSTEM_PROGRAM,
        accounts: vec![
            solana_instruction::AccountMeta::new(world.admin.pubkey(), true),
            solana_instruction::AccountMeta::new(world.prices.pubkey(), true),
        ],
        data,
    };
    let initialize = initialize(&world);
    let prices = world.prices.insecure_clone();
    let failure = send(&mut world, &[allocate, initialize], &[&prices]).expect_err("too short");
    assert!(failure.contains("WrongLength"), "{failure}");
}

#[test]
fn a_full_set_of_four_prices_fits_one_instruction() {
    let mut world = opened_world();
    let admin = world.admin.insecure_clone();
    let updates: Vec<PriceUpdate> = (0..64)
        .map(|index| PriceUpdate {
            feed_index: index,
            value: 1_000_000 + u64::from(index),
            exponent: 6,
        })
        .collect();
    let instruction = set_prices(&world, &admin, updates);
    send(&mut world, &[instruction], &[]).expect("sixty four prices in one instruction");
    assert_eq!(read_price(&world, 63).0, 1_000_063);
}
