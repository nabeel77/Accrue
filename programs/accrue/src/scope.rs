use anchor_lang::prelude::*;

use crate::constants::{BASIS_POINTS_DENOMINATOR, SCOPE_PROGRAM_ID};
use crate::error::AccrueError;
use crate::kamino::SCALED_FRACTION_ONE;

pub const SCOPE_PRICES_ACCOUNT_LEN: usize = 28_712;
pub const MAX_SCOPE_FEEDS: usize = 512;

const OFFSET_FIRST_PRICE: usize = 40;
const DATED_PRICE_LEN: usize = 56;
const DATED_PRICE_VALUE: usize = 0;
const DATED_PRICE_EXPONENT: usize = 8;
const DATED_PRICE_LAST_UPDATED_SLOT: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScopePrice {
    pub value: u64,
    pub exponent: u64,
    pub last_updated_slot: u64,
}

impl ScopePrice {
    pub fn usd_per_whole_token_scaled(&self) -> Result<u128> {
        require!(self.value > 0, AccrueError::OraclePriceIsZero);
        let divisor = ten_to_the(self.exponent)?;
        u128::from(self.value)
            .checked_mul(SCALED_FRACTION_ONE)
            .ok_or(AccrueError::MathOverflow)?
            .checked_div(divisor)
            .ok_or_else(|| AccrueError::MathOverflow.into())
    }

    pub fn age_in_slots(&self, current_slot: u64) -> u64 {
        current_slot.saturating_sub(self.last_updated_slot)
    }
}

pub fn read_scope_price(account: &AccountInfo<'_>, feed_index: u16) -> Result<ScopePrice> {
    require_keys_eq!(
        *account.owner,
        SCOPE_PROGRAM_ID,
        AccrueError::NotAScopeAccount
    );
    let index = usize::from(feed_index);
    require!(index < MAX_SCOPE_FEEDS, AccrueError::ReserveHasNoScopeFeed);

    let data = account.try_borrow_data()?;
    require!(
        data.len() == SCOPE_PRICES_ACCOUNT_LEN,
        AccrueError::ScopeAccountTooShort
    );

    let base = OFFSET_FIRST_PRICE.saturating_add(index.saturating_mul(DATED_PRICE_LEN));
    Ok(ScopePrice {
        value: read_u64_at(&data, base.saturating_add(DATED_PRICE_VALUE))?,
        exponent: read_u64_at(&data, base.saturating_add(DATED_PRICE_EXPONENT))?,
        last_updated_slot: read_u64_at(&data, base.saturating_add(DATED_PRICE_LAST_UPDATED_SLOT))?,
    })
}

pub fn require_price_is_fresh(
    price: &ScopePrice,
    current_slot: u64,
    max_age_slots: u64,
) -> Result<()> {
    require!(
        price.age_in_slots(current_slot) <= max_age_slots,
        AccrueError::OraclePriceIsStale
    );
    Ok(())
}

pub fn usd_value_of_scaled(raw_amount: u64, decimals: u8, price_scaled: u128) -> Result<u128> {
    u128::from(raw_amount)
        .checked_mul(price_scaled)
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(ten_to_the(u64::from(decimals))?)
        .ok_or_else(|| AccrueError::MathOverflow.into())
}

pub fn raw_amount_worth_rounding_up(
    usd_value_scaled: u128,
    decimals: u8,
    price_scaled: u128,
) -> Result<u64> {
    let numerator = usd_value_scaled
        .checked_mul(ten_to_the(u64::from(decimals))?)
        .ok_or(AccrueError::MathOverflow)?;
    let raw = divide_rounding_up(numerator, price_scaled)?;
    u64::try_from(raw).map_err(|_| AccrueError::MathOverflow.into())
}

pub fn raw_amount_worth_rounding_down(
    usd_value_scaled: u128,
    decimals: u8,
    price_scaled: u128,
) -> Result<u64> {
    let raw = usd_value_scaled
        .checked_mul(ten_to_the(u64::from(decimals))?)
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(price_scaled)
        .ok_or(AccrueError::MathOverflow)?;
    u64::try_from(raw).map_err(|_| AccrueError::MathOverflow.into())
}

pub fn add_the_slippage_buffer(raw_amount: u64, max_slippage_bps: u16) -> Result<u64> {
    let remaining_bps = BASIS_POINTS_DENOMINATOR
        .checked_sub(u64::from(max_slippage_bps))
        .ok_or(AccrueError::SlippageAboveCeiling)?;
    require!(remaining_bps > 0, AccrueError::SlippageAboveCeiling);

    let buffered = divide_rounding_up(
        u128::from(raw_amount)
            .checked_mul(u128::from(BASIS_POINTS_DENOMINATOR))
            .ok_or(AccrueError::MathOverflow)?,
        u128::from(remaining_bps),
    )?;
    u64::try_from(buffered).map_err(|_| AccrueError::MathOverflow.into())
}

pub struct SwapSide {
    pub raw_amount: u64,
    pub decimals: u8,
    pub price_scaled: u128,
}

pub fn minimum_output_the_oracle_allows(
    selling: &SwapSide,
    buying_decimals: u8,
    buying_price_scaled: u128,
    max_slippage_bps: u16,
) -> Result<u64> {
    let value_scaled =
        usd_value_of_scaled(selling.raw_amount, selling.decimals, selling.price_scaled)?;
    let fair_output =
        raw_amount_worth_rounding_down(value_scaled, buying_decimals, buying_price_scaled)?;
    let remaining_bps = BASIS_POINTS_DENOMINATOR
        .checked_sub(u64::from(max_slippage_bps))
        .ok_or(AccrueError::SlippageAboveCeiling)?;

    let minimum = u128::from(fair_output)
        .checked_mul(u128::from(remaining_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;
    u64::try_from(minimum).map_err(|_| AccrueError::MathOverflow.into())
}

pub fn divide_rounding_up(numerator: u128, denominator: u128) -> Result<u128> {
    require!(denominator > 0, AccrueError::MathOverflow);
    let quotient = numerator
        .checked_div(denominator)
        .ok_or(AccrueError::MathOverflow)?;
    if numerator
        .checked_rem(denominator)
        .ok_or(AccrueError::MathOverflow)?
        == 0
    {
        Ok(quotient)
    } else {
        quotient
            .checked_add(1)
            .ok_or_else(|| AccrueError::MathOverflow.into())
    }
}

pub fn ten_to_the(power: u64) -> Result<u128> {
    let power = u32::try_from(power).map_err(|_| AccrueError::MathOverflow)?;
    10u128
        .checked_pow(power)
        .ok_or_else(|| AccrueError::MathOverflow.into())
}

fn read_u64_at(data: &[u8], offset: usize) -> Result<u64> {
    let end = offset
        .checked_add(8)
        .ok_or(AccrueError::ScopeAccountTooShort)?;
    let bytes = data
        .get(offset..end)
        .ok_or(AccrueError::ScopeAccountTooShort)?;
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(buffer))
}
