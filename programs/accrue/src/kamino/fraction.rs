use anchor_lang::prelude::*;

use crate::error::AccrueError;

pub const SCALED_FRACTION_BITS: u32 = 60;
pub const SCALED_FRACTION_ONE: u128 = 1u128 << SCALED_FRACTION_BITS;

pub fn read_u64_at(data: &[u8], offset: usize) -> Result<u64> {
    let end = offset
        .checked_add(8)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let bytes = data
        .get(offset..end)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(buffer))
}

pub fn read_u128_at(data: &[u8], offset: usize) -> Result<u128> {
    let end = offset
        .checked_add(16)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let bytes = data
        .get(offset..end)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 16];
    buffer.copy_from_slice(bytes);
    Ok(u128::from_le_bytes(buffer))
}

pub fn read_u16_at(data: &[u8], offset: usize) -> Result<u16> {
    let end = offset
        .checked_add(2)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let bytes = data
        .get(offset..end)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 2];
    buffer.copy_from_slice(bytes);
    Ok(u16::from_le_bytes(buffer))
}

pub fn read_u8_at(data: &[u8], offset: usize) -> Result<u8> {
    data.get(offset)
        .copied()
        .ok_or_else(|| AccrueError::KaminoAccountTooShort.into())
}

pub fn read_pubkey_at(data: &[u8], offset: usize) -> Result<Pubkey> {
    let end = offset
        .checked_add(32)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let bytes = data
        .get(offset..end)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 32];
    buffer.copy_from_slice(bytes);
    Ok(Pubkey::new_from_array(buffer))
}

pub fn scaled_fraction_to_whole_units(scaled: u128) -> u128 {
    scaled >> SCALED_FRACTION_BITS
}

pub fn scaled_fraction_to_whole_units_rounding_up(scaled: u128) -> u128 {
    let remainder_mask = SCALED_FRACTION_ONE.saturating_sub(1);
    let whole = scaled >> SCALED_FRACTION_BITS;
    if scaled & remainder_mask == 0 {
        whole
    } else {
        whole.saturating_add(1)
    }
}

pub fn whole_units_to_scaled_fraction(whole: u128) -> Result<u128> {
    whole
        .checked_shl(SCALED_FRACTION_BITS)
        .ok_or_else(|| AccrueError::MathOverflow.into())
}
