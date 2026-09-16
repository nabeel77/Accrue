use anchor_lang::prelude::*;

use super::fraction::{read_pubkey_at, read_u128_at, read_u16_at, read_u64_at, read_u8_at};
use crate::error::AccrueError;

pub const RESERVE_ACCOUNT_LEN: usize = 8624;

const OFFSET_LAST_UPDATE_SLOT: usize = 16;
const OFFSET_LAST_UPDATE_STALE: usize = 24;
const OFFSET_LENDING_MARKET: usize = 32;
const OFFSET_FARM_COLLATERAL: usize = 64;
const OFFSET_FARM_DEBT: usize = 96;
const OFFSET_LIQUIDITY_MINT: usize = 128;
const OFFSET_LIQUIDITY_SUPPLY_VAULT: usize = 160;
const OFFSET_LIQUIDITY_FEE_VAULT: usize = 192;
const OFFSET_LIQUIDITY_AVAILABLE_AMOUNT: usize = 224;
const OFFSET_LIQUIDITY_BORROWED_AMOUNT_SF: usize = 232;
const OFFSET_LIQUIDITY_MARKET_PRICE_SF: usize = 248;
const OFFSET_LIQUIDITY_MINT_DECIMALS: usize = 272;
const OFFSET_LIQUIDITY_DEPOSIT_LIMIT_CROSSED_TIMESTAMP: usize = 280;
const OFFSET_LIQUIDITY_BORROW_LIMIT_CROSSED_TIMESTAMP: usize = 288;
const OFFSET_LIQUIDITY_TOKEN_PROGRAM: usize = 408;
const OFFSET_COLLATERAL_MINT: usize = 2560;
const OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY: usize = 2592;
const OFFSET_COLLATERAL_SUPPLY_VAULT: usize = 2600;
const OFFSET_CONFIG_STATUS: usize = 4856;
const OFFSET_CONFIG_LOAN_TO_VALUE_PCT: usize = 4872;
const OFFSET_CONFIG_LIQUIDATION_THRESHOLD_PCT: usize = 4873;
const OFFSET_CONFIG_DELEVERAGING_MARGIN_CALL_PERIOD_SECS: usize = 4880;
const OFFSET_CONFIG_BORROW_FACTOR_PCT: usize = 5008;
const OFFSET_CONFIG_DEPOSIT_LIMIT: usize = 5016;
const OFFSET_CONFIG_BORROW_LIMIT: usize = 5024;
const OFFSET_CONFIG_DEPOSIT_WITHDRAWAL_CAP: usize = 5416;
const OFFSET_CONFIG_DEBT_WITHDRAWAL_CAP: usize = 5448;
const OFFSET_CONFIG_AUTODELEVERAGE_ENABLED: usize = 5502;
const OFFSET_CONFIG_SCOPE_PRICE_ACCOUNT: usize = 5112;
const OFFSET_CONFIG_SCOPE_PRICE_CHAIN: usize = 5144;

const WITHDRAWAL_CAP_CURRENT_TOTAL: usize = 8;
const WITHDRAWAL_CAP_INTERVAL_START: usize = 16;
const WITHDRAWAL_CAP_INTERVAL_LENGTH: usize = 24;

const RESERVE_STATUS_ACTIVE: u8 = 0;
const RESERVE_STATUS_OBSOLETE: u8 = 2;

const BASIS_POINTS_PER_PERCENT: u16 = 100;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WithdrawalCap {
    pub config_capacity: i64,
    pub current_total: i64,
    pub last_interval_start_timestamp: u64,
    pub config_interval_length_seconds: u64,
}

impl WithdrawalCap {
    pub fn is_unlimited(&self) -> bool {
        self.config_capacity <= 0
    }

    pub fn remaining_capacity(&self) -> i64 {
        self.config_capacity.saturating_sub(self.current_total)
    }

    pub fn interval_resets_at(&self) -> u64 {
        self.last_interval_start_timestamp
            .saturating_add(self.config_interval_length_seconds)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReserveSnapshot {
    pub last_update_slot: u64,
    pub is_stale: bool,
    pub lending_market: Pubkey,
    pub farm_collateral: Pubkey,
    pub farm_debt: Pubkey,
    pub liquidity_mint: Pubkey,
    pub liquidity_supply_vault: Pubkey,
    pub liquidity_fee_vault: Pubkey,
    pub liquidity_token_program: Pubkey,
    pub liquidity_mint_decimals: u8,
    pub borrow_factor_pct: u64,
    pub liquidity_available_amount: u64,
    pub deposit_limit_crossed_timestamp: u64,
    pub borrow_limit_crossed_timestamp: u64,
    pub liquidity_borrowed_amount_scaled: u128,
    pub liquidity_market_price_scaled: u128,
    pub collateral_mint: Pubkey,
    pub collateral_mint_total_supply: u64,
    pub collateral_supply_vault: Pubkey,
    pub status: u8,
    pub loan_to_value_pct: u8,
    pub liquidation_threshold_pct: u8,
    pub deposit_limit: u64,
    pub borrow_limit: u64,
    pub autodeleverage_enabled: bool,
    pub deleveraging_margin_call_period_seconds: u64,
    pub deposit_withdrawal_cap: WithdrawalCap,
    pub debt_withdrawal_cap: WithdrawalCap,
    pub scope_price_account: Pubkey,
    pub scope_feed_index: u16,
}

impl ReserveSnapshot {
    pub fn has_collateral_farm(&self) -> bool {
        self.farm_collateral != Pubkey::default()
    }

    pub fn has_debt_farm(&self) -> bool {
        self.farm_debt != Pubkey::default()
    }

    pub fn is_active(&self) -> bool {
        self.status == RESERVE_STATUS_ACTIVE
    }

    pub fn is_obsolete(&self) -> bool {
        self.status == RESERVE_STATUS_OBSOLETE
    }

    pub fn is_being_deleveraged(&self) -> bool {
        self.autodeleverage_enabled
            && (self.deposit_limit_crossed_timestamp != 0
                || self.borrow_limit_crossed_timestamp != 0)
    }

    pub fn is_flagged_for_exit(&self) -> bool {
        self.is_obsolete() || self.is_being_deleveraged()
    }

    pub fn max_loan_to_value_bps(&self) -> Result<u16> {
        u16::from(self.loan_to_value_pct)
            .checked_mul(BASIS_POINTS_PER_PERCENT)
            .ok_or_else(|| AccrueError::MathOverflow.into())
    }

    pub fn scope_price_account(&self) -> Result<Pubkey> {
        require!(
            self.scope_price_account != Pubkey::default(),
            AccrueError::ReserveHasNoScopeFeed
        );
        Ok(self.scope_price_account)
    }

    pub fn scope_feed_index(&self) -> Result<u16> {
        require!(
            self.scope_feed_index != u16::MAX,
            AccrueError::ReserveHasNoScopeFeed
        );
        Ok(self.scope_feed_index)
    }

    pub fn borrow_factor_pct(&self) -> Result<u64> {
        require!(
            self.borrow_factor_pct > 0,
            AccrueError::ReserveHasNoBorrowFactor
        );
        Ok(self.borrow_factor_pct)
    }

    pub fn liquidation_threshold_bps(&self) -> Result<u16> {
        u16::from(self.liquidation_threshold_pct)
            .checked_mul(BASIS_POINTS_PER_PERCENT)
            .ok_or_else(|| AccrueError::MathOverflow.into())
    }
}

pub fn read_reserve_account(account: &AccountInfo<'_>) -> Result<ReserveSnapshot> {
    require_keys_eq!(
        *account.owner,
        super::KAMINO_LEND_PROGRAM_ID,
        AccrueError::NotAKaminoAccount
    );
    let data = account.try_borrow_data()?;
    decode_reserve(&data)
}

pub fn decode_reserve(data: &[u8]) -> Result<ReserveSnapshot> {
    require!(
        data.len() == RESERVE_ACCOUNT_LEN,
        AccrueError::KaminoAccountTooShort
    );

    let mint_decimals_wide = read_u64_at(data, OFFSET_LIQUIDITY_MINT_DECIMALS)?;
    let liquidity_mint_decimals =
        u8::try_from(mint_decimals_wide).map_err(|_| AccrueError::KaminoFieldOutOfRange)?;

    Ok(ReserveSnapshot {
        last_update_slot: read_u64_at(data, OFFSET_LAST_UPDATE_SLOT)?,
        is_stale: read_u8_at(data, OFFSET_LAST_UPDATE_STALE)? != 0,
        lending_market: read_pubkey_at(data, OFFSET_LENDING_MARKET)?,
        farm_collateral: read_pubkey_at(data, OFFSET_FARM_COLLATERAL)?,
        farm_debt: read_pubkey_at(data, OFFSET_FARM_DEBT)?,
        liquidity_mint: read_pubkey_at(data, OFFSET_LIQUIDITY_MINT)?,
        liquidity_supply_vault: read_pubkey_at(data, OFFSET_LIQUIDITY_SUPPLY_VAULT)?,
        liquidity_fee_vault: read_pubkey_at(data, OFFSET_LIQUIDITY_FEE_VAULT)?,
        liquidity_token_program: read_pubkey_at(data, OFFSET_LIQUIDITY_TOKEN_PROGRAM)?,
        liquidity_mint_decimals,
        borrow_factor_pct: read_u64_at(data, OFFSET_CONFIG_BORROW_FACTOR_PCT)?,
        liquidity_available_amount: read_u64_at(data, OFFSET_LIQUIDITY_AVAILABLE_AMOUNT)?,
        deposit_limit_crossed_timestamp: read_u64_at(
            data,
            OFFSET_LIQUIDITY_DEPOSIT_LIMIT_CROSSED_TIMESTAMP,
        )?,
        borrow_limit_crossed_timestamp: read_u64_at(
            data,
            OFFSET_LIQUIDITY_BORROW_LIMIT_CROSSED_TIMESTAMP,
        )?,
        liquidity_borrowed_amount_scaled: read_u128_at(data, OFFSET_LIQUIDITY_BORROWED_AMOUNT_SF)?,
        liquidity_market_price_scaled: read_u128_at(data, OFFSET_LIQUIDITY_MARKET_PRICE_SF)?,
        collateral_mint: read_pubkey_at(data, OFFSET_COLLATERAL_MINT)?,
        collateral_mint_total_supply: read_u64_at(data, OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY)?,
        collateral_supply_vault: read_pubkey_at(data, OFFSET_COLLATERAL_SUPPLY_VAULT)?,
        status: read_u8_at(data, OFFSET_CONFIG_STATUS)?,
        loan_to_value_pct: read_u8_at(data, OFFSET_CONFIG_LOAN_TO_VALUE_PCT)?,
        liquidation_threshold_pct: read_u8_at(data, OFFSET_CONFIG_LIQUIDATION_THRESHOLD_PCT)?,
        deposit_limit: read_u64_at(data, OFFSET_CONFIG_DEPOSIT_LIMIT)?,
        borrow_limit: read_u64_at(data, OFFSET_CONFIG_BORROW_LIMIT)?,
        autodeleverage_enabled: read_u8_at(data, OFFSET_CONFIG_AUTODELEVERAGE_ENABLED)? != 0,
        deleveraging_margin_call_period_seconds: read_u64_at(
            data,
            OFFSET_CONFIG_DELEVERAGING_MARGIN_CALL_PERIOD_SECS,
        )?,
        deposit_withdrawal_cap: decode_withdrawal_cap(data, OFFSET_CONFIG_DEPOSIT_WITHDRAWAL_CAP)?,
        debt_withdrawal_cap: decode_withdrawal_cap(data, OFFSET_CONFIG_DEBT_WITHDRAWAL_CAP)?,
        scope_price_account: read_pubkey_at(data, OFFSET_CONFIG_SCOPE_PRICE_ACCOUNT)?,
        scope_feed_index: read_u16_at(data, OFFSET_CONFIG_SCOPE_PRICE_CHAIN)?,
    })
}

fn decode_withdrawal_cap(data: &[u8], base: usize) -> Result<WithdrawalCap> {
    let field_at = |extra: usize| -> Result<usize> {
        base.checked_add(extra)
            .ok_or_else(|| AccrueError::KaminoAccountTooShort.into())
    };
    Ok(WithdrawalCap {
        config_capacity: read_u64_at(data, base)? as i64,
        current_total: read_u64_at(data, field_at(WITHDRAWAL_CAP_CURRENT_TOTAL)?)? as i64,
        last_interval_start_timestamp: read_u64_at(data, field_at(WITHDRAWAL_CAP_INTERVAL_START)?)?,
        config_interval_length_seconds: read_u64_at(
            data,
            field_at(WITHDRAWAL_CAP_INTERVAL_LENGTH)?,
        )?,
    })
}
