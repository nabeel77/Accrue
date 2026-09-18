use accrue::constants::{
    INSTRUCTIONS_SYSVAR_ID, JUPITER_V6_PROGRAM_ID, KAMINO_FARMS_PROGRAM_ID, RENT_SYSVAR_ID,
    SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID,
};
use accrue::kamino::KAMINO_LEND_PROGRAM_ID;
use accrue::state::Strategy;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_signer::Signer;

use crate::world::{PositionTokenAccounts, World};

pub const NVDAX_STRATEGY: Strategy = Strategy {
    target_ltv_bps: 4_000,
    protect_ltv_bps: 5_000,
    grow_below_ltv_bps: 3_000,
    grow_enabled: true,
    exit_on_flag_enabled: true,
};

pub struct OpenedPosition {
    pub address: Address,
    pub obligation: Address,
    pub tokens: PositionTokenAccounts,
}

impl World {
    pub fn borrow_farm_state(&self) -> Address {
        self.borrow.snapshot.farm_debt
    }

    pub fn borrow_obligation_farm_state(&self, obligation: &Address) -> Address {
        self.obligation_farm_state_address(&self.borrow_farm_state(), obligation)
    }

    pub fn open_position_instruction(
        &self,
        position: Address,
        tokens: &PositionTokenAccounts,
        collateral_amount: u64,
        borrow_amount: u64,
        minimum_destination_amount: u64,
        strategy: Strategy,
        leave_usdc_for_later_swap: bool,
        jupiter_route_data: Vec<u8>,
        route_accounts: Vec<AccountMeta>,
    ) -> Instruction {
        let obligation = self.obligation_address(&position);
        let mut accounts = accrue::accounts::OpenPosition {
            owner: self.owner.pubkey(),
            config: self.config_address,
            position,
            collateral_mint: self.collateral.liquidity_mint(),
            destination_mint: self.destination_mint,
            borrow_mint: self.borrow.liquidity_mint(),
            owner_collateral_account: tokens.owner_collateral,
            position_collateral_account: tokens.position_collateral,
            position_usdc_account: tokens.position_usdc,
            position_destination_account: tokens.position_destination,
            lending_market: self.market,
            lending_market_authority: self.market_authority,
            obligation,
            user_metadata: self.user_metadata_address(&position),
            collateral_reserve: self.collateral.address,
            collateral_reserve_liquidity_supply: self.collateral.liquidity_supply_vault(),
            collateral_reserve_collateral_mint: self.collateral.collateral_mint(),
            collateral_reserve_collateral_supply: self.collateral.collateral_supply_vault(),
            borrow_reserve: self.borrow.address,
            borrow_reserve_liquidity_supply: self.borrow.liquidity_supply_vault(),
            borrow_reserve_fee_receiver: self.borrow.liquidity_fee_vault(),
            collateral_reserve_farm_state: None,
            collateral_obligation_farm_state: None,
            borrow_reserve_farm_state: Some(self.borrow_farm_state()),
            borrow_obligation_farm_state: Some(self.borrow_obligation_farm_state(&obligation)),
            scope_prices: self.scope_prices,
            farms_program: KAMINO_FARMS_PROGRAM_ID,
            swap_program: JUPITER_V6_PROGRAM_ID,
            kamino_program: KAMINO_LEND_PROGRAM_ID,
            instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
            collateral_token_program: self.collateral.token_program(),
            kamino_collateral_token_program: TOKEN_PROGRAM_ID,
            borrow_token_program: TOKEN_PROGRAM_ID,
            destination_token_program: self.destination_token_program,
            rent: RENT_SYSVAR_ID,
            system_program: SYSTEM_PROGRAM_ID,
        }
        .to_account_metas(None);
        accounts.extend(route_accounts);

        Instruction {
            program_id: accrue::ID,
            accounts,
            data: accrue::instruction::OpenPosition {
                collateral_amount,
                borrow_amount,
                minimum_destination_amount,
                strategy,
                leave_usdc_for_later_swap,
                jupiter_route_data,
            }
            .data(),
        }
    }

    pub fn open_a_position_awaiting_its_swap(
        &mut self,
        whole_dollars: u64,
        borrow_amount: u64,
    ) -> OpenedPosition {
        let collateral_mint = self.collateral.liquidity_mint();
        let position = self.position_address(&collateral_mint, &self.destination_mint);
        let stock_amount = self.collateral.raw_amount_worth_usd(whole_dollars);
        let tokens = self.fund_owner_and_open_token_accounts(position, stock_amount);

        let instruction = self.open_position_instruction(
            position,
            &tokens,
            stock_amount,
            borrow_amount,
            0,
            NVDAX_STRATEGY,
            true,
            Vec::new(),
            Vec::new(),
        );
        let owner = self.owner.insecure_clone();
        self.send(&[instruction], &[&owner])
            .unwrap_or_else(|failure| {
                panic!(
                    "open_position reverted: {:?}\n{:#?}",
                    failure.err, failure.meta.logs
                )
            });

        OpenedPosition {
            address: position,
            obligation: self.obligation_address(&position),
            tokens,
        }
    }

    pub fn opened_position(
        &self,
        address: Address,
        tokens: PositionTokenAccounts,
    ) -> OpenedPosition {
        OpenedPosition {
            address,
            obligation: self.obligation_address(&address),
            tokens,
        }
    }

    pub fn position(&self, address: &Address) -> accrue::state::Position {
        let account = self.svm.get_account(address).unwrap();
        <accrue::state::Position as anchor_lang::AccountDeserialize>::try_deserialize(
            &mut account.data.as_slice(),
        )
        .unwrap()
    }

    pub fn an_honest_fill(&self, amount_in: u64, amount_out: u64) -> Vec<u8> {
        if self.router_is_hostile {
            hostile_route_data(ATTACK_HONEST_FILL, amount_in, amount_out)
        } else {
            honest_route_data(amount_in, amount_out)
        }
    }

    /// Opens, then buys the destination, so the position is in the state the guard acts on.
    pub fn open_a_guarded_position(&mut self) -> OpenedPosition {
        let destination_out = self.destination_worth_of(7_900_000);
        self.open_a_guarded_position_borrowing(7_900_000, destination_out)
    }

    /// What the borrowed USDC buys at the oracle price, with a little in hand, so a position
    /// that is sold back covers the loan the way a yield token that has grown would.
    pub fn destination_worth_of(&self, usdc_amount: u64) -> u64 {
        let value = accrue::scope::usd_value_of_scaled(
            usdc_amount,
            6,
            self.scope_price_scaled(self.borrow.snapshot.scope_feed_index),
        )
        .unwrap();
        let fair = accrue::scope::raw_amount_worth_rounding_down(
            value,
            9,
            self.scope_price_scaled(crate::world::ONYC_SCOPE_FEED_INDEX),
        )
        .unwrap();
        fair / 100 * 101
    }

    pub fn open_a_guarded_position_borrowing(
        &mut self,
        borrow_amount: u64,
        destination_out: u64,
    ) -> OpenedPosition {
        let opened = self.open_a_position_awaiting_its_swap(20, borrow_amount);
        let route = self.swap_route_accounts(
            opened.address,
            opened.tokens.position_usdc,
            self.borrow.liquidity_mint(),
            TOKEN_PROGRAM_ID,
            opened.tokens.position_destination,
            self.destination_mint,
            self.destination_token_program,
            None,
        );
        self.buy_destination(
            &opened,
            destination_out,
            self.an_honest_fill(borrow_amount, destination_out),
            route,
        )
        .unwrap_or_else(|failure| {
            panic!(
                "buying the destination reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });
        opened
    }

    pub fn swap_route_accounts(
        &self,
        position: Address,
        source: Address,
        source_mint: Address,
        source_token_program: Address,
        destination: Address,
        destination_mint: Address,
        destination_token_program: Address,
        what_the_attack_wants: Option<Address>,
    ) -> Vec<AccountMeta> {
        let mut metas = vec![
            AccountMeta::new_readonly(position, false),
            AccountMeta::new(source, false),
            AccountMeta::new(destination, false),
            AccountMeta::new(self.swap_vault(&source_mint), false),
            AccountMeta::new(self.swap_vault(&destination_mint), false),
            AccountMeta::new_readonly(self.swap_authority, false),
            AccountMeta::new_readonly(source_mint, false),
            AccountMeta::new_readonly(destination_mint, false),
            AccountMeta::new_readonly(source_token_program, false),
            AccountMeta::new_readonly(destination_token_program, false),
        ];
        if let Some(account) = what_the_attack_wants {
            metas.push(AccountMeta::new(account, false));
        }
        metas
    }

    pub fn buy_destination(
        &mut self,
        opened: &OpenedPosition,
        minimum_destination_amount: u64,
        route_data: Vec<u8>,
        route_accounts: Vec<AccountMeta>,
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let mut accounts = accrue::accounts::BuyDestination {
            owner: self.owner.pubkey(),
            config: self.config_address,
            position: opened.address,
            position_collateral_account: opened.tokens.position_collateral,
            position_usdc_account: opened.tokens.position_usdc,
            position_destination_account: opened.tokens.position_destination,
            obligation: opened.obligation,
            collateral_reserve: self.collateral.address,
            swap_program: JUPITER_V6_PROGRAM_ID,
        }
        .to_account_metas(None);
        accounts.extend(route_accounts);

        let instruction = Instruction {
            program_id: accrue::ID,
            accounts,
            data: accrue::instruction::BuyDestination {
                minimum_destination_amount,
                jupiter_route_data: route_data,
            }
            .data(),
        };
        let owner = self.owner.insecure_clone();
        self.send(&[instruction], &[&owner])
    }

    pub fn add_collateral_instruction(
        &self,
        opened: &OpenedPosition,
        owner: Address,
        collateral_amount: u64,
    ) -> Instruction {
        Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::AddCollateral {
                owner,
                position: opened.address,
                collateral_mint: self.collateral.liquidity_mint(),
                position_collateral_account: opened.tokens.position_collateral,
                position_usdc_account: opened.tokens.position_usdc,
                position_destination_account: opened.tokens.position_destination,
                owner_collateral_account: opened.tokens.owner_collateral,
                obligation: opened.obligation,
                lending_market: self.market,
                lending_market_authority: self.market_authority,
                collateral_reserve: self.collateral.address,
                collateral_reserve_liquidity_supply: self.collateral.liquidity_supply_vault(),
                collateral_reserve_collateral_mint: self.collateral.collateral_mint(),
                collateral_reserve_collateral_supply: self.collateral.collateral_supply_vault(),
                borrow_reserve: self.borrow.address,
                collateral_reserve_farm_state: None,
                collateral_obligation_farm_state: None,
                scope_prices: self.scope_prices,
                borrow_scope_prices: self.scope_prices,
                farms_program: KAMINO_FARMS_PROGRAM_ID,
                kamino_program: KAMINO_LEND_PROGRAM_ID,
                instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
                kamino_collateral_token_program: TOKEN_PROGRAM_ID,
                collateral_token_program: self.collateral.token_program(),
            }
            .to_account_metas(None),
            data: accrue::instruction::AddCollateral { collateral_amount }.data(),
        }
    }

    pub fn top_up_instruction(
        &self,
        opened: &OpenedPosition,
        owner: Address,
        collateral_amount: u64,
        borrow_amount: u64,
        minimum_destination_amount: u64,
        leave_usdc_for_later_swap: bool,
        jupiter_route_data: Vec<u8>,
        route_accounts: Vec<AccountMeta>,
    ) -> Instruction {
        let mut accounts = accrue::accounts::TopUp {
            owner,
            config: self.config_address,
            position: opened.address,
            collateral_mint: self.collateral.liquidity_mint(),
            destination_mint: self.destination_mint,
            borrow_mint: self.borrow.liquidity_mint(),
            position_collateral_account: opened.tokens.position_collateral,
            position_usdc_account: opened.tokens.position_usdc,
            position_destination_account: opened.tokens.position_destination,
            owner_collateral_account: opened.tokens.owner_collateral,
            obligation: opened.obligation,
            lending_market: self.market,
            lending_market_authority: self.market_authority,
            collateral_reserve: self.collateral.address,
            collateral_reserve_liquidity_supply: self.collateral.liquidity_supply_vault(),
            collateral_reserve_collateral_mint: self.collateral.collateral_mint(),
            collateral_reserve_collateral_supply: self.collateral.collateral_supply_vault(),
            borrow_reserve: self.borrow.address,
            borrow_reserve_liquidity_supply: self.borrow.liquidity_supply_vault(),
            borrow_reserve_fee_receiver: self.borrow.liquidity_fee_vault(),
            collateral_reserve_farm_state: None,
            collateral_obligation_farm_state: None,
            borrow_reserve_farm_state: Some(self.borrow_farm_state()),
            borrow_obligation_farm_state: Some(
                self.borrow_obligation_farm_state(&opened.obligation),
            ),
            scope_prices: self.scope_prices,
            borrow_scope_prices: self.scope_prices,
            farms_program: KAMINO_FARMS_PROGRAM_ID,
            swap_program: JUPITER_V6_PROGRAM_ID,
            kamino_program: KAMINO_LEND_PROGRAM_ID,
            instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
            kamino_collateral_token_program: TOKEN_PROGRAM_ID,
            collateral_token_program: self.collateral.token_program(),
            borrow_token_program: TOKEN_PROGRAM_ID,
            destination_token_program: self.destination_token_program,
        }
        .to_account_metas(None);
        accounts.extend(route_accounts);

        Instruction {
            program_id: accrue::ID,
            accounts,
            data: accrue::instruction::TopUp {
                collateral_amount,
                borrow_amount,
                minimum_destination_amount,
                leave_usdc_for_later_swap,
                jupiter_route_data,
            }
            .data(),
        }
    }

    pub fn repay_instruction(
        &self,
        opened: &OpenedPosition,
        owner: Address,
        requested_amount: u64,
    ) -> Instruction {
        Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::Repay {
                owner,
                position: opened.address,
                borrow_mint: self.borrow.liquidity_mint(),
                position_collateral_account: opened.tokens.position_collateral,
                position_usdc_account: opened.tokens.position_usdc,
                position_destination_account: opened.tokens.position_destination,
                owner_usdc_account: opened.tokens.owner_usdc,
                obligation: opened.obligation,
                lending_market: self.market,
                lending_market_authority: self.market_authority,
                collateral_reserve: self.collateral.address,
                borrow_reserve: self.borrow.address,
                borrow_reserve_liquidity_supply: self.borrow.liquidity_supply_vault(),
                borrow_reserve_farm_state: Some(self.borrow_farm_state()),
                borrow_obligation_farm_state: Some(
                    self.borrow_obligation_farm_state(&opened.obligation),
                ),
                collateral_scope_prices: self.scope_prices,
                borrow_scope_prices: self.scope_prices,
                farms_program: KAMINO_FARMS_PROGRAM_ID,
                kamino_program: KAMINO_LEND_PROGRAM_ID,
                instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
                borrow_token_program: TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
            data: accrue::instruction::Repay { requested_amount }.data(),
        }
    }

    pub fn withdraw_collateral_instruction(
        &self,
        opened: &OpenedPosition,
        owner: Address,
        collateral_token_amount: u64,
    ) -> Instruction {
        Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::WithdrawCollateral {
                owner,
                position: opened.address,
                collateral_mint: self.collateral.liquidity_mint(),
                position_collateral_account: opened.tokens.position_collateral,
                position_usdc_account: opened.tokens.position_usdc,
                position_destination_account: opened.tokens.position_destination,
                owner_collateral_account: opened.tokens.owner_collateral,
                obligation: opened.obligation,
                lending_market: self.market,
                lending_market_authority: self.market_authority,
                collateral_reserve: self.collateral.address,
                collateral_reserve_collateral_supply: self.collateral.collateral_supply_vault(),
                collateral_reserve_collateral_mint: self.collateral.collateral_mint(),
                collateral_reserve_liquidity_supply: self.collateral.liquidity_supply_vault(),
                borrow_reserve: self.borrow.address,
                borrow_mint: self.borrow.liquidity_mint(),
                collateral_reserve_farm_state: None,
                collateral_obligation_farm_state: None,
                collateral_scope_prices: self.scope_prices,
                borrow_scope_prices: self.scope_prices,
                farms_program: KAMINO_FARMS_PROGRAM_ID,
                kamino_program: KAMINO_LEND_PROGRAM_ID,
                instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
                kamino_collateral_token_program: TOKEN_PROGRAM_ID,
                collateral_token_program: self.collateral.token_program(),
            }
            .to_account_metas(None),
            data: accrue::instruction::WithdrawCollateral {
                collateral_token_amount,
            }
            .data(),
        }
    }

    pub fn set_strategy_instruction(
        &self,
        opened: &OpenedPosition,
        owner: Address,
        strategy: Strategy,
    ) -> Instruction {
        Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::SetStrategy {
                owner,
                position: opened.address,
                position_collateral_account: opened.tokens.position_collateral,
                position_usdc_account: opened.tokens.position_usdc,
                position_destination_account: opened.tokens.position_destination,
                obligation: opened.obligation,
                collateral_reserve: self.collateral.address,
            }
            .to_account_metas(None),
            data: accrue::instruction::SetStrategy { strategy }.data(),
        }
    }

    pub fn unwind_instruction(
        &self,
        opened: &OpenedPosition,
        owner: Address,
        minimum_usdc_out: u64,
        jupiter_route_data: Vec<u8>,
        route_accounts: Vec<AccountMeta>,
    ) -> Instruction {
        let mut accounts = accrue::accounts::Unwind {
            owner,
            config: self.config_address,
            position: opened.address,
            collateral_mint: self.collateral.liquidity_mint(),
            destination_mint: self.destination_mint,
            borrow_mint: self.borrow.liquidity_mint(),
            position_collateral_account: opened.tokens.position_collateral,
            position_usdc_account: opened.tokens.position_usdc,
            position_destination_account: opened.tokens.position_destination,
            owner_collateral_account: opened.tokens.owner_collateral,
            owner_usdc_account: opened.tokens.owner_usdc,
            owner_destination_account: opened.tokens.owner_destination,
            treasury_usdc_account: self.treasury_usdc_account,
            obligation: opened.obligation,
            lending_market: self.market,
            lending_market_authority: self.market_authority,
            collateral_reserve: self.collateral.address,
            collateral_reserve_collateral_supply: self.collateral.collateral_supply_vault(),
            collateral_reserve_collateral_mint: self.collateral.collateral_mint(),
            collateral_reserve_liquidity_supply: self.collateral.liquidity_supply_vault(),
            borrow_reserve: self.borrow.address,
            borrow_reserve_liquidity_supply: self.borrow.liquidity_supply_vault(),
            collateral_reserve_farm_state: None,
            collateral_obligation_farm_state: None,
            borrow_reserve_farm_state: Some(self.borrow_farm_state()),
            borrow_obligation_farm_state: Some(
                self.borrow_obligation_farm_state(&opened.obligation),
            ),
            collateral_scope_prices: self.scope_prices,
            borrow_scope_prices: self.scope_prices,
            farms_program: KAMINO_FARMS_PROGRAM_ID,
            swap_program: JUPITER_V6_PROGRAM_ID,
            kamino_program: KAMINO_LEND_PROGRAM_ID,
            instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
            kamino_collateral_token_program: TOKEN_PROGRAM_ID,
            collateral_token_program: self.collateral.token_program(),
            borrow_token_program: TOKEN_PROGRAM_ID,
            destination_token_program: self.destination_token_program,
        }
        .to_account_metas(None);
        accounts.extend(route_accounts);

        Instruction {
            program_id: accrue::ID,
            accounts,
            data: accrue::instruction::Unwind {
                minimum_usdc_out,
                jupiter_route_data,
            }
            .data(),
        }
    }

    pub fn rescue_instruction(&self, opened: &OpenedPosition, owner: Address) -> Instruction {
        Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::Rescue {
                owner,
                position: opened.address,
                collateral_mint: self.collateral.liquidity_mint(),
                destination_mint: self.destination_mint,
                borrow_mint: self.borrow.liquidity_mint(),
                position_collateral_account: opened.tokens.position_collateral,
                position_usdc_account: opened.tokens.position_usdc,
                position_destination_account: opened.tokens.position_destination,
                owner_collateral_account: opened.tokens.owner_collateral,
                owner_usdc_account: opened.tokens.owner_usdc,
                owner_destination_account: opened.tokens.owner_destination,
                obligation: opened.obligation,
                lending_market: self.market,
                lending_market_authority: self.market_authority,
                collateral_reserve: self.collateral.address,
                collateral_reserve_collateral_supply: self.collateral.collateral_supply_vault(),
                collateral_reserve_collateral_mint: self.collateral.collateral_mint(),
                collateral_reserve_liquidity_supply: self.collateral.liquidity_supply_vault(),
                collateral_reserve_farm_state: None,
                collateral_obligation_farm_state: None,
                borrow_reserve: self.borrow.address,
                scope_prices: self.scope_prices,
                borrow_scope_prices: self.scope_prices,
                farms_program: KAMINO_FARMS_PROGRAM_ID,
                kamino_program: KAMINO_LEND_PROGRAM_ID,
                instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
                kamino_collateral_token_program: TOKEN_PROGRAM_ID,
                collateral_token_program: self.collateral.token_program(),
                borrow_token_program: TOKEN_PROGRAM_ID,
                destination_token_program: self.destination_token_program,
            }
            .to_account_metas(None),
            data: accrue::instruction::Rescue {}.data(),
        }
    }

    pub fn close_position_instruction(
        &self,
        opened: &OpenedPosition,
        owner: Address,
    ) -> Instruction {
        Instruction {
            program_id: accrue::ID,
            accounts: accrue::accounts::ClosePosition {
                owner,
                position: opened.address,
                position_collateral_account: opened.tokens.position_collateral,
                position_usdc_account: opened.tokens.position_usdc,
                position_destination_account: opened.tokens.position_destination,
                obligation: opened.obligation,
                collateral_reserve: self.collateral.address,
                collateral_token_program: self.collateral.token_program(),
                borrow_token_program: TOKEN_PROGRAM_ID,
                destination_token_program: self.destination_token_program,
            }
            .to_account_metas(None),
            data: accrue::instruction::ClosePosition {}.data(),
        }
    }
}

impl World {
    pub fn protect_instruction(
        &self,
        opened: &OpenedPosition,
        caller: Address,
        caller_usdc_account: Address,
        owner_minimum_usdc_out: u64,
        jupiter_route_data: Vec<u8>,
        route_accounts: Vec<AccountMeta>,
    ) -> Instruction {
        let mut accounts = accrue::accounts::Protect {
            caller,
            caller_usdc_account,
            config: self.config_address,
            position: opened.address,
            destination_mint: self.destination_mint,
            borrow_mint: self.borrow.liquidity_mint(),
            position_collateral_account: opened.tokens.position_collateral,
            position_usdc_account: opened.tokens.position_usdc,
            position_destination_account: opened.tokens.position_destination,
            obligation: opened.obligation,
            lending_market: self.market,
            lending_market_authority: self.market_authority,
            collateral_reserve: self.collateral.address,
            borrow_reserve: self.borrow.address,
            borrow_reserve_liquidity_supply: self.borrow.liquidity_supply_vault(),
            borrow_reserve_farm_state: Some(self.borrow_farm_state()),
            borrow_obligation_farm_state: Some(
                self.borrow_obligation_farm_state(&opened.obligation),
            ),
            collateral_scope_prices: self.scope_prices,
            borrow_scope_prices: self.scope_prices,
            destination_scope_prices: self.scope_prices,
            farms_program: KAMINO_FARMS_PROGRAM_ID,
            swap_program: JUPITER_V6_PROGRAM_ID,
            kamino_program: KAMINO_LEND_PROGRAM_ID,
            instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
            borrow_token_program: TOKEN_PROGRAM_ID,
            destination_token_program: self.destination_token_program,
        }
        .to_account_metas(None);
        accounts.extend(route_accounts);

        Instruction {
            program_id: accrue::ID,
            accounts,
            data: accrue::instruction::Protect {
                owner_minimum_usdc_out,
                jupiter_route_data,
            }
            .data(),
        }
    }

    pub fn grow_instruction(
        &self,
        opened: &OpenedPosition,
        caller: Address,
        owner_minimum_destination_out: u64,
        jupiter_route_data: Vec<u8>,
        route_accounts: Vec<AccountMeta>,
    ) -> Instruction {
        let mut accounts = accrue::accounts::Grow {
            caller,
            config: self.config_address,
            position: opened.address,
            destination_mint: self.destination_mint,
            borrow_mint: self.borrow.liquidity_mint(),
            position_collateral_account: opened.tokens.position_collateral,
            position_usdc_account: opened.tokens.position_usdc,
            position_destination_account: opened.tokens.position_destination,
            obligation: opened.obligation,
            lending_market: self.market,
            lending_market_authority: self.market_authority,
            collateral_reserve: self.collateral.address,
            borrow_reserve: self.borrow.address,
            borrow_reserve_liquidity_supply: self.borrow.liquidity_supply_vault(),
            borrow_reserve_fee_receiver: self.borrow.liquidity_fee_vault(),
            borrow_reserve_farm_state: Some(self.borrow_farm_state()),
            borrow_obligation_farm_state: Some(
                self.borrow_obligation_farm_state(&opened.obligation),
            ),
            collateral_scope_prices: self.scope_prices,
            borrow_scope_prices: self.scope_prices,
            destination_scope_prices: self.scope_prices,
            farms_program: KAMINO_FARMS_PROGRAM_ID,
            swap_program: JUPITER_V6_PROGRAM_ID,
            kamino_program: KAMINO_LEND_PROGRAM_ID,
            instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
            borrow_token_program: TOKEN_PROGRAM_ID,
            destination_token_program: self.destination_token_program,
        }
        .to_account_metas(None);
        accounts.extend(route_accounts);

        Instruction {
            program_id: accrue::ID,
            accounts,
            data: accrue::instruction::Grow {
                owner_minimum_destination_out,
                jupiter_route_data,
            }
            .data(),
        }
    }

    pub fn leave_instruction(
        &self,
        opened: &OpenedPosition,
        caller: Address,
        jupiter_route_data: Vec<u8>,
        route_accounts: Vec<AccountMeta>,
    ) -> Instruction {
        let mut accounts = accrue::accounts::Leave {
            caller,
            config: self.config_address,
            position: opened.address,
            collateral_mint: self.collateral.liquidity_mint(),
            destination_mint: self.destination_mint,
            borrow_mint: self.borrow.liquidity_mint(),
            position_collateral_account: opened.tokens.position_collateral,
            position_usdc_account: opened.tokens.position_usdc,
            position_destination_account: opened.tokens.position_destination,
            owner_collateral_account: opened.tokens.owner_collateral,
            owner_usdc_account: opened.tokens.owner_usdc,
            owner_destination_account: opened.tokens.owner_destination,
            owner: self.owner.pubkey(),
            obligation: opened.obligation,
            lending_market: self.market,
            lending_market_authority: self.market_authority,
            collateral_reserve: self.collateral.address,
            collateral_reserve_collateral_supply: self.collateral.collateral_supply_vault(),
            collateral_reserve_collateral_mint: self.collateral.collateral_mint(),
            collateral_reserve_liquidity_supply: self.collateral.liquidity_supply_vault(),
            borrow_reserve: self.borrow.address,
            borrow_reserve_liquidity_supply: self.borrow.liquidity_supply_vault(),
            collateral_reserve_farm_state: None,
            collateral_obligation_farm_state: None,
            borrow_reserve_farm_state: Some(self.borrow_farm_state()),
            borrow_obligation_farm_state: Some(
                self.borrow_obligation_farm_state(&opened.obligation),
            ),
            collateral_scope_prices: self.scope_prices,
            borrow_scope_prices: self.scope_prices,
            destination_scope_prices: self.scope_prices,
            farms_program: KAMINO_FARMS_PROGRAM_ID,
            swap_program: JUPITER_V6_PROGRAM_ID,
            kamino_program: KAMINO_LEND_PROGRAM_ID,
            instruction_sysvar: INSTRUCTIONS_SYSVAR_ID,
            kamino_collateral_token_program: TOKEN_PROGRAM_ID,
            collateral_token_program: self.collateral.token_program(),
            borrow_token_program: TOKEN_PROGRAM_ID,
            destination_token_program: self.destination_token_program,
        }
        .to_account_metas(None);
        accounts.extend(route_accounts);

        Instruction {
            program_id: accrue::ID,
            accounts,
            data: accrue::instruction::Leave { jupiter_route_data }.data(),
        }
    }
}

pub const ATTACK_HONEST_FILL: u8 = 5;

pub fn honest_route_data(amount_in: u64, amount_out: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&amount_out.to_le_bytes());
    data
}

pub fn hostile_route_data(mode: u8, amount_in: u64, amount_out: u64) -> Vec<u8> {
    let mut data = vec![mode];
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&amount_out.to_le_bytes());
    data
}
