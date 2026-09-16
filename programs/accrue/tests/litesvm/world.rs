use accrue::constants::{
    ASSOCIATED_TOKEN_PROGRAM_ID, CONFIG_SEED, JUPITER_V6_PROGRAM_ID, KAMINO_FARMS_PROGRAM_ID,
    POSITION_SEED, SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
};
use accrue::kamino::{decode_reserve, ReserveSnapshot, KAMINO_LEND_PROGRAM_ID};
use accrue::state::{CollateralEntry, ConfigLimits, DestinationEntry};
use anchor_lang::{InstructionData, ToAccountMetas};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

use crate::snapshot::{
    farms_program_path, kamino_program_path, load_mainnet_snapshot, MainnetSnapshot,
};

pub const COLLATERAL_RESERVE_LABEL: &str = "reserve_nvdax";
pub const BORROW_RESERVE_LABEL: &str = "reserve_usdc";
pub const DESTINATION_MINT_LABEL: &str = "mint_onyc";
pub const MARKET_LABEL: &str = "xstocks_market";
pub const SCOPE_PRICES_LABEL: &str = "oracle_scope_prices";
pub const ONYC_SCOPE_FEED_INDEX: u16 = 350;
pub const ONYC_SCOPE_TWAP_FEED_INDEX: u16 = 478;
const RESERVE_TWAP_CHAIN_OFFSET: usize = 5_152;
const SCOPE_FIRST_PRICE_OFFSET: usize = 40;
const SCOPE_DATED_PRICE_LEN: usize = 56;

pub const MARKET_AUTHORITY_SEED: &[u8] = b"lma";
pub const USER_METADATA_SEED: &[u8] = b"user_meta";
pub const FARM_USER_STATE_SEED: &[u8] = b"user";
pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap";
pub const SWAP_VAULT_BALANCE: u64 = 1_000_000_000_000;

const FUNDING_LAMPORTS: u64 = 100_000_000_000;
const TOKEN_ACCOUNT_BASE_LEN: usize = 165;
const TOKEN_ACCOUNT_INITIALIZED: u8 = 1;
const TOKEN_2022_ACCOUNT_DISCRIMINATOR: u8 = 2;
const IMMUTABLE_OWNER_EXTENSION: u16 = 7;
const MINT_ACCOUNT_LEN: usize = 82;
const TOKEN_ACCOUNT_RENT_LAMPORTS: u64 = 2_039_280;
const MINT_ACCOUNT_RENT_LAMPORTS: u64 = 1_461_600;
const VAULT_HEADROOM_MULTIPLIER: u64 = 4;
const SLOTS_PER_SECOND: u64 = 2;
const SLOTS_PER_EPOCH: u64 = 432_000;
const COMPUTE_BUDGET_PROGRAM_ID: Address =
    solana_address::address!("ComputeBudget111111111111111111111111111111");
const SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR: u8 = 2;
const TRANSACTION_COMPUTE_LIMIT: u32 = 1_400_000;

pub struct ReserveUnderTest {
    pub address: Address,
    pub snapshot: ReserveSnapshot,
}

impl ReserveUnderTest {
    pub fn liquidity_mint(&self) -> Address {
        self.snapshot.liquidity_mint
    }

    pub fn liquidity_supply_vault(&self) -> Address {
        self.snapshot.liquidity_supply_vault
    }

    pub fn liquidity_fee_vault(&self) -> Address {
        self.snapshot.liquidity_fee_vault
    }

    pub fn collateral_mint(&self) -> Address {
        self.snapshot.collateral_mint
    }

    pub fn collateral_supply_vault(&self) -> Address {
        self.snapshot.collateral_supply_vault
    }

    pub fn token_program(&self) -> Address {
        self.snapshot.liquidity_token_program
    }

    pub fn raw_amount_worth_usd(&self, whole_dollars: u64) -> u64 {
        let scaled_one = accrue::kamino::SCALED_FRACTION_ONE;
        let units = 10u128.pow(u32::from(self.snapshot.liquidity_mint_decimals));
        let raw = u128::from(whole_dollars) * units * scaled_one
            / self.snapshot.liquidity_market_price_scaled;
        u64::try_from(raw).unwrap()
    }
}

pub struct World {
    pub svm: LiteSVM,
    pub clock: Clock,
    pub owner: Keypair,
    pub admin: Keypair,
    pub guardian: Keypair,
    pub stranger: Keypair,
    pub config_address: Address,
    pub treasury_usdc_account: Address,
    pub market: Address,
    pub market_authority: Address,
    pub scope_prices: Address,
    pub collateral: ReserveUnderTest,
    pub borrow: ReserveUnderTest,
    pub destination_mint: Address,
    pub destination_token_program: Address,
    pub swap_authority: Address,
    pub router_is_hostile: bool,
}

impl World {
    pub fn new() -> Self {
        let snapshot = load_mainnet_snapshot().unwrap();
        let MainnetSnapshot {
            mut svm,
            slot,
            unix_timestamp,
            ..
        } = snapshot;
        let clock = Clock {
            slot,
            epoch_start_timestamp: unix_timestamp,
            epoch: slot / SLOTS_PER_EPOCH,
            leader_schedule_epoch: slot / SLOTS_PER_EPOCH,
            unix_timestamp,
        };

        let reference = load_mainnet_snapshot().unwrap();
        svm.add_program_from_file(KAMINO_LEND_PROGRAM_ID, kamino_program_path())
            .unwrap();
        svm.add_program_from_file(KAMINO_FARMS_PROGRAM_ID, farms_program_path())
            .unwrap();
        svm.add_program_from_file(accrue::ID, compiled_program_path())
            .unwrap();

        let market = reference.address_of(MARKET_LABEL).unwrap();
        let scope_prices = reference.address_of(SCOPE_PRICES_LABEL).unwrap();
        let (market_authority, _) = Address::find_program_address(
            &[MARKET_AUTHORITY_SEED, market.as_ref()],
            &KAMINO_LEND_PROGRAM_ID,
        );

        let collateral = ReserveUnderTest {
            address: reference.address_of(COLLATERAL_RESERVE_LABEL).unwrap(),
            snapshot: decode_reserve(&fixture_data(&reference, COLLATERAL_RESERVE_LABEL)).unwrap(),
        };
        let borrow = ReserveUnderTest {
            address: reference.address_of(BORROW_RESERVE_LABEL).unwrap(),
            snapshot: decode_reserve(&fixture_data(&reference, BORROW_RESERVE_LABEL)).unwrap(),
        };
        let destination_mint = reference.address_of(DESTINATION_MINT_LABEL).unwrap();

        let owner = Keypair::new();
        let admin = Keypair::new();
        let guardian = Keypair::new();
        let stranger = Keypair::new();
        for key in [&owner, &admin, &guardian, &stranger] {
            svm.airdrop(&key.pubkey(), FUNDING_LAMPORTS).unwrap();
        }

        let (config_address, _) = Address::find_program_address(&[CONFIG_SEED], &accrue::ID);
        let (swap_authority, _) =
            Address::find_program_address(&[SWAP_AUTHORITY_SEED], &JUPITER_V6_PROGRAM_ID);

        let mut world = Self {
            svm,
            clock,
            owner,
            admin,
            guardian,
            stranger,
            config_address,
            treasury_usdc_account: Address::default(),
            market,
            market_authority,
            scope_prices,
            collateral,
            borrow,
            destination_mint,
            destination_token_program: TOKEN_PROGRAM_ID,
            swap_authority,
            router_is_hostile: false,
        };

        world.seed_reserve_vaults();
        world.treasury_usdc_account = world.create_token_account(
            world.borrow.liquidity_mint(),
            world.admin.pubkey(),
            0,
            TOKEN_PROGRAM_ID,
        );
        world.initialize_config();
        world
    }

    pub fn install_swap_program(&mut self, file_name: &str) {
        self.router_is_hostile = file_name.contains("hostile");
        let path = crate::snapshot::fixtures_directory()
            .join("../../target/deploy")
            .join(file_name);
        self.svm
            .add_program_from_file(JUPITER_V6_PROGRAM_ID, &path)
            .unwrap_or_else(|error| {
                panic!(
                    "{} did not load. Run `cargo build-sbf` for the test swap programs first: {error:?}",
                    path.display()
                )
            });

        let authority = self.swap_authority;
        for (mint, token_program) in [
            (
                self.collateral.liquidity_mint(),
                self.collateral.token_program(),
            ),
            (self.borrow.liquidity_mint(), TOKEN_PROGRAM_ID),
            (self.destination_mint, self.destination_token_program),
        ] {
            let vault = self.swap_vault(&mint);
            self.set_token_account(vault, mint, authority, SWAP_VAULT_BALANCE, token_program);
        }
    }

    pub fn swap_vault(&self, mint: &Address) -> Address {
        let (address, _) =
            Address::find_program_address(&[b"vault", mint.as_ref()], &JUPITER_V6_PROGRAM_ID);
        address
    }

    fn seed_reserve_vaults(&mut self) {
        let collateral_available = self.collateral.snapshot.liquidity_available_amount;
        let borrow_available = self.borrow.snapshot.liquidity_available_amount;

        self.set_token_account(
            self.collateral.liquidity_supply_vault(),
            self.collateral.liquidity_mint(),
            self.market_authority,
            collateral_available,
            self.collateral.token_program(),
        );
        self.set_token_account(
            self.collateral.liquidity_fee_vault(),
            self.collateral.liquidity_mint(),
            self.market_authority,
            0,
            self.collateral.token_program(),
        );
        self.set_mint_account(
            self.collateral.collateral_mint(),
            self.market_authority,
            self.collateral.snapshot.collateral_mint_total_supply,
            self.collateral.snapshot.liquidity_mint_decimals,
        );
        self.set_token_account(
            self.collateral.collateral_supply_vault(),
            self.collateral.collateral_mint(),
            self.market_authority,
            self.collateral.snapshot.collateral_mint_total_supply,
            TOKEN_PROGRAM_ID,
        );

        self.set_token_account(
            self.borrow.liquidity_supply_vault(),
            self.borrow.liquidity_mint(),
            self.market_authority,
            borrow_available,
            self.borrow.token_program(),
        );
        self.set_token_account(
            self.borrow.liquidity_fee_vault(),
            self.borrow.liquidity_mint(),
            self.market_authority,
            0,
            self.borrow.token_program(),
        );
        self.set_mint_account(
            self.borrow.collateral_mint(),
            self.market_authority,
            self.borrow.snapshot.collateral_mint_total_supply,
            self.borrow.snapshot.liquidity_mint_decimals,
        );
        self.set_token_account(
            self.borrow.collateral_supply_vault(),
            self.borrow.collateral_mint(),
            self.market_authority,
            self.borrow.snapshot.collateral_mint_total_supply,
            TOKEN_PROGRAM_ID,
        );
    }

    fn initialize_config(&mut self) {
        let instruction = Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::InitializeConfig {
                deployer: self.admin.pubkey(),
                config: self.config_address,
                treasury: self.treasury_usdc_account,
                system_program: SYSTEM_PROGRAM_ID,
            }
            .to_account_metas(None),
            data: accrue::instruction::InitializeConfig {
                admin: self.admin.pubkey(),
                guardian: self.guardian.pubkey(),
                borrow_mint: self.borrow.liquidity_mint(),
                borrow_reserve: self.borrow.address,
                limits: default_limits(),
            }
            .data(),
        };
        self.send(&[instruction], &[&self.admin.insecure_clone()])
            .unwrap();

        let collateral_entry = CollateralEntry {
            mint: self.collateral.liquidity_mint(),
            reserve: self.collateral.address,
            token_program: self.collateral.token_program(),
            scope_price_account: self.scope_prices,
            scope_feed_index: self.collateral.snapshot.scope_feed_index,
            enabled: true,
        };
        let destination_entry = DestinationEntry {
            mint: self.destination_mint,
            token_program: self.destination_token_program,
            scope_price_account: self.scope_prices,
            scope_feed_index: ONYC_SCOPE_FEED_INDEX,
            enabled: true,
        };
        self.update_config(accrue::instructions::ConfigUpdate {
            collateral: Some(collateral_entry),
            ..Default::default()
        })
        .unwrap();
        self.update_config(accrue::instructions::ConfigUpdate {
            destination: Some(destination_entry),
            ..Default::default()
        })
        .unwrap();
    }

    pub fn update_config(
        &mut self,
        update: accrue::instructions::ConfigUpdate,
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let admin = self.admin.insecure_clone();
        self.update_config_as(&admin, update)
    }

    pub fn update_config_as(
        &mut self,
        signer: &Keypair,
        update: accrue::instructions::ConfigUpdate,
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let instruction = Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::UpdateConfig {
                admin: signer.pubkey(),
                config: self.config_address,
            }
            .to_account_metas(None),
            data: accrue::instruction::UpdateConfig { update }.data(),
        };
        self.send(&[instruction], &[&signer.insecure_clone()])
    }

    pub fn set_paused_as(
        &mut self,
        signer: &Keypair,
        open_paused: Option<bool>,
        grow_paused: Option<bool>,
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let instruction = Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::SetPaused {
                authority: signer.pubkey(),
                config: self.config_address,
            }
            .to_account_metas(None),
            data: accrue::instruction::SetPaused {
                open_paused,
                grow_paused,
            }
            .data(),
        };
        self.send(&[instruction], &[&signer.insecure_clone()])
    }

    pub fn set_sunset_as(
        &mut self,
        signer: &Keypair,
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let instruction = Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::SetSunset {
                admin: signer.pubkey(),
                config: self.config_address,
            }
            .to_account_metas(None),
            data: accrue::instruction::SetSunset {}.data(),
        };
        self.send(&[instruction], &[&signer.insecure_clone()])
    }

    pub fn config(&self) -> accrue::state::Config {
        let account = self.svm.get_account(&self.config_address).unwrap();
        <accrue::state::Config as anchor_lang::AccountDeserialize>::try_deserialize(
            &mut account.data.as_slice(),
        )
        .unwrap()
    }

    pub fn send(
        &mut self,
        instructions: &[Instruction],
        signers: &[&Keypair],
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let payer = signers.first().unwrap().pubkey();
        self.svm.expire_blockhash();
        let mut with_budget = vec![set_compute_unit_limit(TRANSACTION_COMPUTE_LIMIT)];
        with_budget.extend_from_slice(instructions);
        let message = Message::new(&with_budget, Some(&payer));
        let transaction = Transaction::new(&signers.to_vec(), message, self.svm.latest_blockhash());
        self.svm.send_transaction(transaction)
    }

    pub fn position_address(
        &self,
        collateral_mint: &Address,
        destination_mint: &Address,
    ) -> Address {
        let (address, _) = Address::find_program_address(
            &[
                POSITION_SEED,
                self.owner.pubkey().as_ref(),
                collateral_mint.as_ref(),
                destination_mint.as_ref(),
            ],
            &accrue::ID,
        );
        address
    }

    pub fn obligation_address(&self, position: &Address) -> Address {
        let system_program = SYSTEM_PROGRAM_ID;
        let (address, _) = Address::find_program_address(
            &[
                &[0u8],
                &[0u8],
                position.as_ref(),
                self.market.as_ref(),
                system_program.as_ref(),
                system_program.as_ref(),
            ],
            &KAMINO_LEND_PROGRAM_ID,
        );
        address
    }

    pub fn obligation_farm_state_address(
        &self,
        reserve_farm_state: &Address,
        obligation: &Address,
    ) -> Address {
        let (address, _) = Address::find_program_address(
            &[
                FARM_USER_STATE_SEED,
                reserve_farm_state.as_ref(),
                obligation.as_ref(),
            ],
            &KAMINO_FARMS_PROGRAM_ID,
        );
        address
    }

    pub fn user_metadata_address(&self, position: &Address) -> Address {
        let (address, _) = Address::find_program_address(
            &[USER_METADATA_SEED, position.as_ref()],
            &KAMINO_LEND_PROGRAM_ID,
        );
        address
    }

    pub fn associated_token_address(
        &self,
        owner: &Address,
        mint: &Address,
        token_program: &Address,
    ) -> Address {
        let (address, _) = Address::find_program_address(
            &[owner.as_ref(), token_program.as_ref(), mint.as_ref()],
            &ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        address
    }

    pub fn create_token_account(
        &mut self,
        mint: Address,
        owner: Address,
        amount: u64,
        token_program: Address,
    ) -> Address {
        let address = self.associated_token_address(&owner, &mint, &token_program);
        self.set_token_account(address, mint, owner, amount, token_program);
        address
    }

    pub fn set_token_account(
        &mut self,
        address: Address,
        mint: Address,
        owner: Address,
        amount: u64,
        token_program: Address,
    ) {
        let data = token_account_data(&mint, &owner, amount, &token_program);
        self.svm
            .set_account(
                address,
                Account {
                    lamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
                    data,
                    owner: token_program,
                    executable: false,
                    rent_epoch: u64::MAX,
                },
            )
            .unwrap();
    }

    fn set_mint_account(
        &mut self,
        address: Address,
        mint_authority: Address,
        supply: u64,
        decimals: u8,
    ) {
        self.svm
            .set_account(
                address,
                Account {
                    lamports: MINT_ACCOUNT_RENT_LAMPORTS,
                    data: mint_account_data(&mint_authority, supply, decimals),
                    owner: TOKEN_PROGRAM_ID,
                    executable: false,
                    rent_epoch: u64::MAX,
                },
            )
            .unwrap();
    }

    /// What a keeper does before it decides: refresh both reserves and the obligation with plain
    /// permissionless instructions, then read the loan to value off the chain.
    pub fn refresh_the_market_from_outside(&mut self) {
        let market = self.market;
        let scope = self.scope_prices;
        let mut instructions = Vec::new();
        for reserve in [self.collateral.address, self.borrow.address] {
            instructions.push(
                accrue::kamino::generated::instructions::RefreshReserve {
                    reserve,
                    lending_market: market,
                    pyth_oracle: None,
                    switchboard_price_oracle: None,
                    switchboard_twap_oracle: None,
                    scope_prices: Some(scope),
                }
                .instruction(),
            );
        }
        self.svm.expire_blockhash();
        let payer = self.stranger.insecure_clone();
        self.send(&instructions, &[&payer])
            .unwrap_or_else(|failure| {
                panic!("refreshing the reserves reverted: {:?}", failure.err)
            });
    }

    pub fn refresh_the_obligation_from_outside(&mut self, obligation: Address) {
        let mut instruction = accrue::kamino::generated::instructions::RefreshObligation {
            lending_market: self.market,
            obligation,
        }
        .instruction();
        for reserve in [self.collateral.address, self.borrow.address] {
            instruction
                .accounts
                .push(solana_instruction::AccountMeta::new(reserve, false));
        }
        let payer = self.stranger.insecure_clone();
        self.send(&[instruction], &[&payer])
            .unwrap_or_else(|failure| {
                panic!("refreshing the obligation reverted: {:?}", failure.err)
            });
    }

    /// The pair the guard reads: the debt weighted the way the market liquidates on, and the
    /// deposited value it is measured against.
    pub fn obligation_values_scaled(&self, obligation: &Address) -> (u128, u128) {
        let snapshot = self.decoded_obligation(obligation).unwrap();
        (
            snapshot.borrow_factor_adjusted_debt_value_scaled,
            snapshot.deposited_value_scaled,
        )
    }

    pub fn borrow_factor_pct(&self) -> u64 {
        self.borrow.snapshot.borrow_factor_pct
    }

    pub fn obligation_loan_to_value_bps(&self, obligation: &Address) -> u16 {
        self.decoded_obligation(obligation)
            .map_or(0, |snapshot| snapshot.loan_to_value_bps().unwrap())
    }

    pub fn scope_price_scaled(&self, feed_index: u16) -> u128 {
        let (value, exponent, last_updated_slot) = self.scope_price(feed_index);
        accrue::scope::ScopePrice {
            value,
            exponent,
            last_updated_slot,
        }
        .usd_per_whole_token_scaled()
        .unwrap()
    }

    pub fn scope_price(&self, feed_index: u16) -> (u64, u64, u64) {
        let account = self.svm.get_account(&self.scope_prices).unwrap();
        let base = SCOPE_FIRST_PRICE_OFFSET + usize::from(feed_index) * SCOPE_DATED_PRICE_LEN;
        let read = |offset: usize| {
            let mut buffer = [0u8; 8];
            buffer.copy_from_slice(&account.data[base + offset..base + offset + 8]);
            u64::from_le_bytes(buffer)
        };
        (read(0), read(8), read(16))
    }

    pub fn write_scope_price(&mut self, feed_index: u16, value: u64, last_updated_slot: u64) {
        let mut account = self.svm.get_account(&self.scope_prices).unwrap();
        let base = SCOPE_FIRST_PRICE_OFFSET + usize::from(feed_index) * SCOPE_DATED_PRICE_LEN;
        account.data[base..base + 8].copy_from_slice(&value.to_le_bytes());
        account.data[base + 16..base + 24].copy_from_slice(&last_updated_slot.to_le_bytes());
        account.data[base + 24..base + 32]
            .copy_from_slice(&self.clock.unix_timestamp.to_le_bytes());
        self.svm.set_account(self.scope_prices, account).unwrap();
    }

    /// Every feed the lending market and the program read, price and the twap it is checked
    /// against, so a synthetic move stays inside the market's own divergence rules.
    pub fn every_feed_in_play(&self) -> [u16; 6] {
        [
            self.collateral.snapshot.scope_feed_index,
            self.twap_feed_of(&self.collateral.address),
            self.borrow.snapshot.scope_feed_index,
            self.twap_feed_of(&self.borrow.address),
            ONYC_SCOPE_FEED_INDEX,
            ONYC_SCOPE_TWAP_FEED_INDEX,
        ]
    }

    pub fn twap_feed_of(&self, reserve: &Address) -> u16 {
        let account = self.svm.get_account(reserve).unwrap();
        let mut buffer = [0u8; 2];
        buffer.copy_from_slice(
            &account.data[RESERVE_TWAP_CHAIN_OFFSET..RESERVE_TWAP_CHAIN_OFFSET + 2],
        );
        u16::from_le_bytes(buffer)
    }

    /// Moves a price and the twap it is checked against together, the way a real move would.
    pub fn move_the_price(&mut self, feed_index: u16, numerator: u64, denominator: u64) {
        let twap = if feed_index == self.collateral.snapshot.scope_feed_index {
            self.twap_feed_of(&self.collateral.address)
        } else if feed_index == self.borrow.snapshot.scope_feed_index {
            self.twap_feed_of(&self.borrow.address)
        } else {
            ONYC_SCOPE_TWAP_FEED_INDEX
        };
        let slot = self.clock.slot;
        for feed in [feed_index, twap] {
            let (value, _, _) = self.scope_price(feed);
            let moved =
                u64::try_from(u128::from(value) * u128::from(numerator) / u128::from(denominator))
                    .unwrap();
            self.write_scope_price(feed, moved, slot);
        }
    }

    pub fn make_the_price_stale(&mut self, feed_index: u16, slots_old: u64) {
        let (value, _, _) = self.scope_price(feed_index);
        let slot = self.clock.slot.saturating_sub(slots_old);
        self.write_scope_price(feed_index, value, slot);
    }

    pub fn move_time_forward(&mut self, seconds: i64) {
        self.clock.unix_timestamp += seconds;
        self.clock.slot += u64::try_from(seconds).unwrap() * SLOTS_PER_SECOND;
        self.svm.warp_to_slot(self.clock.slot);
        self.svm.set_sysvar(&self.clock.clone());
        self.keep_every_scope_price_fresh();
    }

    pub fn keep_every_scope_price_fresh(&mut self) {
        let slot = self.clock.slot;
        for feed in self.every_feed_in_play() {
            let (value, _, _) = self.scope_price(feed);
            self.write_scope_price(feed, value, slot);
        }
    }

    pub fn now(&self) -> i64 {
        self.clock.unix_timestamp
    }

    pub fn obligation_collateral(&self, obligation: &Address) -> u64 {
        self.decoded_obligation(obligation).map_or(0, |snapshot| {
            snapshot.deposited_amount_for_reserve(&self.collateral.address)
        })
    }

    pub fn obligation_debt(&self, obligation: &Address) -> u128 {
        self.decoded_obligation(obligation).map_or(0, |snapshot| {
            snapshot.borrowed_amount_scaled_for_reserve(&self.borrow.address)
        })
    }

    pub fn decoded_obligation(
        &self,
        obligation: &Address,
    ) -> Option<accrue::kamino::ObligationSnapshot> {
        let account = self.svm.get_account(obligation)?;
        if account.data.is_empty() {
            return None;
        }
        Some(accrue::kamino::decode_obligation(&account.data).unwrap())
    }

    pub fn token_balance(&self, address: &Address) -> u64 {
        let account = self.svm.get_account(address).unwrap();
        let mut buffer = [0u8; 8];
        buffer.copy_from_slice(&account.data[64..72]);
        u64::from_le_bytes(buffer)
    }

    pub fn lamports_of(&self, address: &Address) -> u64 {
        self.svm
            .get_account(address)
            .map_or(0, |account| account.lamports)
    }

    /// Gives the owner a stock balance and opens the three position token accounts the client
    /// would create in the same transaction as the open.
    pub fn fund_owner_and_open_token_accounts(
        &mut self,
        position: Address,
        stock_amount: u64,
    ) -> PositionTokenAccounts {
        let owner_key = self.owner.pubkey();
        let collateral_mint = self.collateral.liquidity_mint();
        let collateral_program = self.collateral.token_program();
        let borrow_mint = self.borrow.liquidity_mint();
        let destination_mint = self.destination_mint;
        let destination_program = self.destination_token_program;

        let owner_collateral = self.create_token_account(
            collateral_mint,
            owner_key,
            stock_amount.saturating_mul(VAULT_HEADROOM_MULTIPLIER),
            collateral_program,
        );
        let owner_usdc = self.create_token_account(borrow_mint, owner_key, 0, TOKEN_PROGRAM_ID);
        let owner_destination =
            self.create_token_account(destination_mint, owner_key, 0, destination_program);

        let position_collateral =
            self.create_token_account(collateral_mint, position, 0, collateral_program);
        let position_usdc = self.create_token_account(borrow_mint, position, 0, TOKEN_PROGRAM_ID);
        let position_destination =
            self.create_token_account(destination_mint, position, 0, destination_program);

        PositionTokenAccounts {
            owner_collateral,
            owner_usdc,
            owner_destination,
            position_collateral,
            position_usdc,
            position_destination,
        }
    }
}

pub struct PositionTokenAccounts {
    pub owner_collateral: Address,
    pub owner_usdc: Address,
    pub owner_destination: Address,
    pub position_collateral: Address,
    pub position_usdc: Address,
    pub position_destination: Address,
}

pub fn default_limits() -> ConfigLimits {
    ConfigLimits {
        keeper_bounty_bps: 10,
        keeper_bounty_cap_usdc: 5_000_000,
        performance_fee_bps: 1_000,
        max_slippage_bps: 100,
        max_price_age_slots: 150,
        min_protect_interval_seconds: 600,
        min_grow_interval_seconds: 3_600,
        max_share_of_available_bps: 1_000,
        min_position_usd: 10,
        max_position_usd: 50,
    }
}

pub fn compiled_program_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/accrue.so")
}

fn set_compute_unit_limit(units: u32) -> Instruction {
    let mut data = vec![SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: COMPUTE_BUDGET_PROGRAM_ID,
        accounts: Vec::new(),
        data,
    }
}

fn fixture_data(snapshot: &MainnetSnapshot, label: &str) -> Vec<u8> {
    BASE64_STANDARD
        .decode(&snapshot.account_by_label(label).unwrap().data_base64)
        .unwrap()
}

fn token_account_data(
    mint: &Address,
    owner: &Address,
    amount: u64,
    token_program: &Address,
) -> Vec<u8> {
    let mut data = vec![0u8; TOKEN_ACCOUNT_BASE_LEN];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = TOKEN_ACCOUNT_INITIALIZED;

    if *token_program == TOKEN_2022_PROGRAM_ID {
        data.push(TOKEN_2022_ACCOUNT_DISCRIMINATOR);
        data.extend_from_slice(&IMMUTABLE_OWNER_EXTENSION.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
    }
    data
}

fn mint_account_data(mint_authority: &Address, supply: u64, decimals: u8) -> Vec<u8> {
    let mut data = vec![0u8; MINT_ACCOUNT_LEN];
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[4..36].copy_from_slice(mint_authority.as_ref());
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    data
}
