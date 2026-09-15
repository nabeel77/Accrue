use anchor_lang::prelude::*;

use super::fraction::{read_pubkey_at, read_u128_at, read_u64_at, read_u8_at};
use crate::error::AccrueError;

pub const OBLIGATION_ACCOUNT_LEN: usize = 3344;
pub const MAX_OBLIGATION_DEPOSITS: usize = 8;
pub const MAX_OBLIGATION_BORROWS: usize = 5;

const OFFSET_TAG: usize = 8;
const OFFSET_LAST_UPDATE_SLOT: usize = 16;
const OFFSET_LAST_UPDATE_STALE: usize = 24;
const OFFSET_LENDING_MARKET: usize = 32;
const OFFSET_OWNER: usize = 64;
const OFFSET_DEPOSITS: usize = 96;
const OFFSET_DEPOSITED_VALUE_SF: usize = 1192;
const OFFSET_BORROWS: usize = 1208;
const OFFSET_BORROW_FACTOR_ADJUSTED_DEBT_VALUE_SF: usize = 2208;
const OFFSET_BORROWED_ASSETS_MARKET_VALUE_SF: usize = 2224;
const OFFSET_ALLOWED_BORROW_VALUE_SF: usize = 2240;
const OFFSET_UNHEALTHY_BORROW_VALUE_SF: usize = 2256;
const OFFSET_ELEVATION_GROUP: usize = 2285;
const OFFSET_HAS_DEBT: usize = 2287;
const OFFSET_REFERRER: usize = 2288;

const DEPOSIT_ENTRY_LEN: usize = 136;
const DEPOSIT_DEPOSITED_AMOUNT: usize = 32;
const DEPOSIT_MARKET_VALUE_SF: usize = 40;

const BORROW_ENTRY_LEN: usize = 200;
const BORROW_BORROWED_AMOUNT_SF: usize = 88;
const BORROW_MARKET_VALUE_SF: usize = 104;
const BORROW_FACTOR_ADJUSTED_MARKET_VALUE_SF: usize = 120;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ObligationDeposit {
    pub deposit_reserve: Pubkey,
    pub deposited_amount: u64,
    pub market_value_scaled: u128,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ObligationBorrow {
    pub borrow_reserve: Pubkey,
    pub borrowed_amount_scaled: u128,
    pub market_value_scaled: u128,
    pub borrow_factor_adjusted_market_value_scaled: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ObligationSnapshot {
    pub tag: u64,
    pub last_update_slot: u64,
    pub is_stale: bool,
    pub lending_market: Pubkey,
    pub owner: Pubkey,
    pub deposits: [ObligationDeposit; MAX_OBLIGATION_DEPOSITS],
    pub borrows: [ObligationBorrow; MAX_OBLIGATION_BORROWS],
    pub deposited_value_scaled: u128,
    pub borrowed_assets_market_value_scaled: u128,
    pub borrow_factor_adjusted_debt_value_scaled: u128,
    pub allowed_borrow_value_scaled: u128,
    pub unhealthy_borrow_value_scaled: u128,
    pub elevation_group: u8,
    pub has_debt: bool,
    pub referrer: Pubkey,
}

impl ObligationSnapshot {
    pub fn deposit_for_reserve(&self, reserve: &Pubkey) -> Option<&ObligationDeposit> {
        self.deposits
            .iter()
            .find(|deposit| deposit.deposit_reserve == *reserve)
    }

    pub fn borrow_for_reserve(&self, reserve: &Pubkey) -> Option<&ObligationBorrow> {
        self.borrows
            .iter()
            .find(|borrow| borrow.borrow_reserve == *reserve)
    }

    pub fn deposited_amount_for_reserve(&self, reserve: &Pubkey) -> u64 {
        self.deposit_for_reserve(reserve)
            .map_or(0, |deposit| deposit.deposited_amount)
    }

    pub fn borrowed_amount_scaled_for_reserve(&self, reserve: &Pubkey) -> u128 {
        self.borrow_for_reserve(reserve)
            .map_or(0, |borrow| borrow.borrowed_amount_scaled)
    }

    pub fn loan_to_value_bps(&self) -> Result<u16> {
        if self.deposited_value_scaled == 0 {
            return Ok(0);
        }
        let numerator = self
            .borrowed_assets_market_value_scaled
            .checked_mul(10_000)
            .ok_or(AccrueError::MathOverflow)?;
        let ratio = numerator
            .checked_div(self.deposited_value_scaled)
            .ok_or(AccrueError::MathOverflow)?;
        u16::try_from(ratio.min(u128::from(u16::MAX))).map_err(|_| AccrueError::MathOverflow.into())
    }
}

pub fn read_obligation_account(account: &AccountInfo<'_>) -> Result<ObligationSnapshot> {
    require_keys_eq!(
        *account.owner,
        super::KAMINO_LEND_PROGRAM_ID,
        AccrueError::NotAKaminoAccount
    );
    let data = account.try_borrow_data()?;
    decode_obligation(&data)
}

pub fn decode_obligation(data: &[u8]) -> Result<ObligationSnapshot> {
    require!(
        data.len() == OBLIGATION_ACCOUNT_LEN,
        AccrueError::KaminoAccountTooShort
    );

    let mut deposits = [ObligationDeposit::default(); MAX_OBLIGATION_DEPOSITS];
    for (index, slot) in deposits.iter_mut().enumerate() {
        let base = OFFSET_DEPOSITS
            .checked_add(index.saturating_mul(DEPOSIT_ENTRY_LEN))
            .ok_or(AccrueError::KaminoAccountTooShort)?;
        *slot = ObligationDeposit {
            deposit_reserve: read_pubkey_at(data, base)?,
            deposited_amount: read_u64_at(data, base.saturating_add(DEPOSIT_DEPOSITED_AMOUNT))?,
            market_value_scaled: read_u128_at(data, base.saturating_add(DEPOSIT_MARKET_VALUE_SF))?,
        };
    }

    let mut borrows = [ObligationBorrow::default(); MAX_OBLIGATION_BORROWS];
    for (index, slot) in borrows.iter_mut().enumerate() {
        let base = OFFSET_BORROWS
            .checked_add(index.saturating_mul(BORROW_ENTRY_LEN))
            .ok_or(AccrueError::KaminoAccountTooShort)?;
        *slot = ObligationBorrow {
            borrow_reserve: read_pubkey_at(data, base)?,
            borrowed_amount_scaled: read_u128_at(
                data,
                base.saturating_add(BORROW_BORROWED_AMOUNT_SF),
            )?,
            market_value_scaled: read_u128_at(data, base.saturating_add(BORROW_MARKET_VALUE_SF))?,
            borrow_factor_adjusted_market_value_scaled: read_u128_at(
                data,
                base.saturating_add(BORROW_FACTOR_ADJUSTED_MARKET_VALUE_SF),
            )?,
        };
    }

    Ok(ObligationSnapshot {
        tag: read_u64_at(data, OFFSET_TAG)?,
        last_update_slot: read_u64_at(data, OFFSET_LAST_UPDATE_SLOT)?,
        is_stale: read_u8_at(data, OFFSET_LAST_UPDATE_STALE)? != 0,
        lending_market: read_pubkey_at(data, OFFSET_LENDING_MARKET)?,
        owner: read_pubkey_at(data, OFFSET_OWNER)?,
        deposits,
        borrows,
        deposited_value_scaled: read_u128_at(data, OFFSET_DEPOSITED_VALUE_SF)?,
        borrowed_assets_market_value_scaled: read_u128_at(
            data,
            OFFSET_BORROWED_ASSETS_MARKET_VALUE_SF,
        )?,
        borrow_factor_adjusted_debt_value_scaled: read_u128_at(
            data,
            OFFSET_BORROW_FACTOR_ADJUSTED_DEBT_VALUE_SF,
        )?,
        allowed_borrow_value_scaled: read_u128_at(data, OFFSET_ALLOWED_BORROW_VALUE_SF)?,
        unhealthy_borrow_value_scaled: read_u128_at(data, OFFSET_UNHEALTHY_BORROW_VALUE_SF)?,
        elevation_group: read_u8_at(data, OFFSET_ELEVATION_GROUP)?,
        has_debt: read_u8_at(data, OFFSET_HAS_DEBT)? != 0,
        referrer: read_pubkey_at(data, OFFSET_REFERRER)?,
    })
}
