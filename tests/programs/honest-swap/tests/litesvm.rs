use honest_swap::{
    pool_address, FUND_TAG, INITIALIZE_POOL_TAG, POOL_ACCOUNT_LEN, POOL_MAGIC, SET_RATE_TAG,
    SWAP_AUTHORITY_SEED,
};
use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

type Address = solana_address::Address;

const SYSTEM_PROGRAM: Address = Address::new_from_array([0u8; 32]);
const TOKEN_PROGRAM: Address =
    Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM: Address =
    Address::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const MINT_LEN: u64 = 82;
const TOKEN_ACCOUNT_LEN: u64 = 165;

fn swap_program() -> Address {
    Address::from_str_const("8mFrzd3bJ4Czmi8ee5tJUDmCDLByBaUbP6vUUzpCsYWW")
}

fn program_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/deploy/honest_swap.so")
}

struct World {
    svm: LiteSVM,
    admin: Keypair,
    program: Address,
}

fn create_account_instruction(
    payer: &Address,
    new_account: &Address,
    lamports: u64,
    space: u64,
    owner: &Address,
) -> Instruction {
    let mut data = vec![0u8; 4];
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&space.to_le_bytes());
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: SYSTEM_PROGRAM,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*new_account, true),
        ],
        data,
    }
}

fn new_world() -> World {
    let mut svm = LiteSVM::new();
    let program = swap_program();
    svm.add_program_from_file(program, program_path())
        .expect("the honest router is built into target/deploy");
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 1_000_000_000_000).unwrap();
    World {
        svm,
        admin,
        program,
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

fn create_mint(world: &mut World, decimals: u8) -> Address {
    let mint = Keypair::new();
    let lamports = world
        .svm
        .minimum_balance_for_rent_exemption(MINT_LEN as usize);
    let create = create_account_instruction(
        &world.admin.pubkey(),
        &mint.pubkey(),
        lamports,
        MINT_LEN,
        &TOKEN_PROGRAM,
    );
    let mut data = vec![20u8, decimals];
    data.extend_from_slice(world.admin.pubkey().as_ref());
    data.push(0);
    let initialize = Instruction {
        program_id: TOKEN_PROGRAM,
        accounts: vec![AccountMeta::new(mint.pubkey(), false)],
        data,
    };
    send(world, &[create, initialize], &[&mint]).expect("the mint is created");
    mint.pubkey()
}

fn create_token_account_for_the_admin(world: &mut World, mint: &Address) -> Address {
    let owner = &world.admin.pubkey().to_owned();
    let account = Keypair::new();
    let lamports = world
        .svm
        .minimum_balance_for_rent_exemption(TOKEN_ACCOUNT_LEN as usize);
    let create = create_account_instruction(
        &world.admin.pubkey(),
        &account.pubkey(),
        lamports,
        TOKEN_ACCOUNT_LEN,
        &TOKEN_PROGRAM,
    );
    let mut data = vec![18u8];
    data.extend_from_slice(owner.as_ref());
    let initialize = Instruction {
        program_id: TOKEN_PROGRAM,
        accounts: vec![
            AccountMeta::new(account.pubkey(), false),
            AccountMeta::new_readonly(*mint, false),
        ],
        data,
    };
    send(world, &[create, initialize], &[&account]).expect("the token account is created");
    account.pubkey()
}

fn mint_to(world: &mut World, mint: &Address, account: &Address, amount: u64) {
    let mut data = vec![7u8];
    data.extend_from_slice(&amount.to_le_bytes());
    let instruction = Instruction {
        program_id: TOKEN_PROGRAM,
        accounts: vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new(*account, false),
            AccountMeta::new_readonly(world.admin.pubkey(), true),
        ],
        data,
    };
    send(world, &[instruction], &[]).expect("the mint authority mints");
}

fn token_balance(world: &World, account: &Address) -> u64 {
    let raw = world.svm.get_account(account).unwrap();
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(&raw.data[64..72]);
    u64::from_le_bytes(buffer)
}

fn vault_authority(program: &Address) -> Address {
    Address::find_program_address(&[SWAP_AUTHORITY_SEED], program).0
}

fn vault_for(program: &Address, mint: &Address) -> Address {
    Address::find_program_address(
        &[
            vault_authority(program).as_ref(),
            TOKEN_PROGRAM.as_ref(),
            mint.as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM,
    )
    .0
}

fn initialize_pool_instruction(
    world: &World,
    source_mint: &Address,
    destination_mint: &Address,
    numerator: u64,
    denominator: u64,
) -> Instruction {
    let program = world.program;
    let mut data = vec![INITIALIZE_POOL_TAG];
    data.extend_from_slice(&numerator.to_le_bytes());
    data.extend_from_slice(&denominator.to_le_bytes());
    Instruction {
        program_id: program,
        accounts: vec![
            AccountMeta::new(world.admin.pubkey(), true),
            AccountMeta::new(
                pool_address(&program, source_mint, destination_mint).0,
                false,
            ),
            AccountMeta::new_readonly(vault_authority(&program), false),
            AccountMeta::new_readonly(*source_mint, false),
            AccountMeta::new_readonly(*destination_mint, false),
            AccountMeta::new(vault_for(&program, source_mint), false),
            AccountMeta::new(vault_for(&program, destination_mint), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(ASSOCIATED_TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data,
    }
}

fn read_pool(world: &World, source_mint: &Address, destination_mint: &Address) -> Vec<u8> {
    let address = pool_address(&world.program, source_mint, destination_mint).0;
    world.svm.get_account(&address).unwrap().data
}

fn word_at(data: &[u8], offset: usize) -> u64 {
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(&data[offset..offset + 8]);
    u64::from_le_bytes(buffer)
}

struct Pair {
    usdc: Address,
    onyc: Address,
}

fn world_with_a_pool() -> (World, Pair) {
    let mut world = new_world();
    let usdc = create_mint(&mut world, 6);
    let onyc = create_mint(&mut world, 6);
    let instruction = initialize_pool_instruction(&world, &usdc, &onyc, 1_020_000, 1_000_000);
    send(&mut world, &[instruction], &[]).expect("the pool is created");
    (world, Pair { usdc, onyc })
}

#[test]
fn a_pool_carries_its_pair_its_vaults_and_its_rate() {
    let (world, pair) = world_with_a_pool();
    let data = read_pool(&world, &pair.usdc, &pair.onyc);
    assert_eq!(data.len(), POOL_ACCOUNT_LEN);
    assert_eq!(&data[0..8], &POOL_MAGIC);
    assert_eq!(&data[8..40], world.admin.pubkey().as_ref());
    assert_eq!(&data[40..72], pair.usdc.as_ref());
    assert_eq!(&data[72..104], pair.onyc.as_ref());
    assert_eq!(
        &data[104..136],
        vault_for(&world.program, &pair.usdc).as_ref()
    );
    assert_eq!(
        &data[136..168],
        vault_for(&world.program, &pair.onyc).as_ref()
    );
    assert_eq!(word_at(&data, 168), 1_020_000);
    assert_eq!(word_at(&data, 176), 1_000_000);
}

#[test]
fn the_vaults_belong_to_the_swap_authority() {
    let (world, pair) = world_with_a_pool();
    for mint in [pair.usdc, pair.onyc] {
        let vault = world
            .svm
            .get_account(&vault_for(&world.program, &mint))
            .unwrap();
        assert_eq!(vault.owner, TOKEN_PROGRAM);
        assert_eq!(
            &vault.data[32..64],
            vault_authority(&world.program).as_ref()
        );
        assert_eq!(&vault.data[0..32], mint.as_ref());
    }
}

#[test]
fn initialize_pool_runs_again_without_complaint() {
    let (mut world, pair) = world_with_a_pool();
    let instruction = initialize_pool_instruction(&world, &pair.usdc, &pair.onyc, 7, 11);
    send(&mut world, &[instruction], &[]).expect("a second initialize is a rewrite");
    let data = read_pool(&world, &pair.usdc, &pair.onyc);
    assert_eq!(word_at(&data, 168), 7);
    assert_eq!(word_at(&data, 176), 11);
}

#[test]
fn a_pool_for_the_other_direction_is_its_own_account() {
    let (mut world, pair) = world_with_a_pool();
    let instruction =
        initialize_pool_instruction(&world, &pair.onyc, &pair.usdc, 1_000_000, 1_020_000);
    send(&mut world, &[instruction], &[]).expect("the reverse pool is created");
    assert_ne!(
        pool_address(&world.program, &pair.usdc, &pair.onyc).0,
        pool_address(&world.program, &pair.onyc, &pair.usdc).0
    );
    let data = read_pool(&world, &pair.onyc, &pair.usdc);
    assert_eq!(word_at(&data, 168), 1_000_000);
    assert_eq!(word_at(&data, 176), 1_020_000);
}

#[test]
fn a_denominator_of_zero_is_refused() {
    let mut world = new_world();
    let usdc = create_mint(&mut world, 6);
    let onyc = create_mint(&mut world, 6);
    let instruction = initialize_pool_instruction(&world, &usdc, &onyc, 1, 0);
    send(&mut world, &[instruction], &[]).expect_err("a rate cannot divide by zero");
}

#[test]
fn fund_fills_a_vault_from_the_funders_own_account() {
    let (mut world, pair) = world_with_a_pool();
    let holding = create_token_account_for_the_admin(&mut world, &pair.onyc);
    mint_to(&mut world, &pair.onyc, &holding, 500_000_000);

    let vault = vault_for(&world.program, &pair.onyc);
    let mut data = vec![FUND_TAG];
    data.extend_from_slice(&300_000_000u64.to_le_bytes());
    let instruction = Instruction {
        program_id: world.program,
        accounts: vec![
            AccountMeta::new(world.admin.pubkey(), true),
            AccountMeta::new(holding, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(pair.onyc, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data,
    };
    send(&mut world, &[instruction], &[]).expect("the vault is funded");
    assert_eq!(token_balance(&world, &vault), 300_000_000);
    assert_eq!(token_balance(&world, &holding), 200_000_000);
}

#[test]
fn the_admin_moves_the_rate() {
    let (mut world, pair) = world_with_a_pool();
    let mut data = vec![SET_RATE_TAG];
    data.extend_from_slice(&1_224_000u64.to_le_bytes());
    data.extend_from_slice(&1_000_000u64.to_le_bytes());
    let instruction = Instruction {
        program_id: world.program,
        accounts: vec![
            AccountMeta::new_readonly(world.admin.pubkey(), true),
            AccountMeta::new(
                pool_address(&world.program, &pair.usdc, &pair.onyc).0,
                false,
            ),
        ],
        data,
    };
    send(&mut world, &[instruction], &[]).expect("the admin sets the rate");
    let pool = read_pool(&world, &pair.usdc, &pair.onyc);
    assert_eq!(word_at(&pool, 168), 1_224_000);
    assert_eq!(word_at(&pool, 176), 1_000_000);
}

#[test]
fn nobody_but_the_admin_moves_the_rate() {
    let (mut world, pair) = world_with_a_pool();
    let stranger = Keypair::new();
    world
        .svm
        .airdrop(&stranger.pubkey(), 1_000_000_000)
        .unwrap();
    let mut data = vec![SET_RATE_TAG];
    data.extend_from_slice(&1u64.to_le_bytes());
    data.extend_from_slice(&1u64.to_le_bytes());
    let instruction = Instruction {
        program_id: world.program,
        accounts: vec![
            AccountMeta::new_readonly(stranger.pubkey(), true),
            AccountMeta::new(
                pool_address(&world.program, &pair.usdc, &pair.onyc).0,
                false,
            ),
        ],
        data,
    };
    send(&mut world, &[instruction], &[&stranger]).expect_err("a stranger is refused");
    let pool = read_pool(&world, &pair.usdc, &pair.onyc);
    assert_eq!(word_at(&pool, 168), 1_020_000);
}

#[test]
fn the_sixteen_byte_swap_still_fills_exactly_as_it_did() {
    let (mut world, pair) = world_with_a_pool();
    let holding = create_token_account_for_the_admin(&mut world, &pair.onyc);
    mint_to(&mut world, &pair.onyc, &holding, 500_000_000);
    let onyc_vault = vault_for(&world.program, &pair.onyc);
    let mut fund_data = vec![FUND_TAG];
    fund_data.extend_from_slice(&500_000_000u64.to_le_bytes());
    let fill_the_vault = Instruction {
        program_id: world.program,
        accounts: vec![
            AccountMeta::new(world.admin.pubkey(), true),
            AccountMeta::new(holding, false),
            AccountMeta::new(onyc_vault, false),
            AccountMeta::new_readonly(pair.onyc, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data: fund_data,
    };
    send(&mut world, &[fill_the_vault], &[]).expect("the payout vault is funded");

    let usdc_holding = create_token_account_for_the_admin(&mut world, &pair.usdc);
    mint_to(&mut world, &pair.usdc, &usdc_holding, 100_000_000);
    let onyc_received = create_token_account_for_the_admin(&mut world, &pair.onyc);
    let usdc_vault = vault_for(&world.program, &pair.usdc);

    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&50_000_000u64.to_le_bytes());
    data.extend_from_slice(&49_019_607u64.to_le_bytes());
    assert_eq!(data.len(), 16);
    let swap = Instruction {
        program_id: world.program,
        accounts: vec![
            AccountMeta::new(world.admin.pubkey(), true),
            AccountMeta::new(usdc_holding, false),
            AccountMeta::new(onyc_received, false),
            AccountMeta::new(usdc_vault, false),
            AccountMeta::new(onyc_vault, false),
            AccountMeta::new_readonly(vault_authority(&world.program), false),
            AccountMeta::new_readonly(pair.usdc, false),
            AccountMeta::new_readonly(pair.onyc, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data,
    };
    send(&mut world, &[swap], &[]).expect("the swap fills");
    assert_eq!(token_balance(&world, &onyc_received), 49_019_607);
    assert_eq!(token_balance(&world, &usdc_holding), 50_000_000);
    assert_eq!(token_balance(&world, &usdc_vault), 50_000_000);
}

#[test]
fn an_unknown_tag_is_refused() {
    let mut world = new_world();
    let instruction = Instruction {
        program_id: world.program,
        accounts: vec![AccountMeta::new(world.admin.pubkey(), true)],
        data: vec![9u8, 0, 0],
    };
    send(&mut world, &[instruction], &[]).expect_err("an unknown tag is refused");
}
