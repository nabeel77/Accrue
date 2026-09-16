use anchor_lang::prelude::*;

use super::fraction::read_u8_at;
use crate::error::AccrueError;

pub const LENDING_MARKET_ACCOUNT_LEN: usize = 4664;

const OFFSET_AUTODELEVERAGE_ENABLED: usize = 123;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LendingMarketSnapshot {
    pub autodeleverage_enabled: bool,
}

pub fn read_lending_market_account(account: &AccountInfo<'_>) -> Result<LendingMarketSnapshot> {
    require_keys_eq!(
        *account.owner,
        super::KAMINO_LEND_PROGRAM_ID,
        AccrueError::NotAKaminoAccount
    );
    let data = account.try_borrow_data()?;
    decode_lending_market(&data)
}

pub fn decode_lending_market(data: &[u8]) -> Result<LendingMarketSnapshot> {
    require!(
        data.len() == LENDING_MARKET_ACCOUNT_LEN,
        AccrueError::KaminoAccountTooShort
    );
    Ok(LendingMarketSnapshot {
        autodeleverage_enabled: read_u8_at(data, OFFSET_AUTODELEVERAGE_ENABLED)? != 0,
    })
}
