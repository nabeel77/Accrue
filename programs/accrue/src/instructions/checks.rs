use anchor_lang::prelude::*;

use crate::error::AccrueError;
use crate::invariants::token_account_mint;
use crate::kamino::ReserveSnapshot;
use crate::state::Position;

pub fn require_collateral_reserve_of_position(
    position: &Position,
    reserve: &ReserveSnapshot,
) -> Result<()> {
    require_keys_eq!(
        reserve.liquidity_mint,
        position.collateral_mint,
        AccrueError::CollateralNotAllowed
    );
    require_keys_eq!(
        reserve.lending_market,
        position.market,
        AccrueError::CollateralNotAllowed
    );
    Ok(())
}

pub fn require_reserve_on_the_positions_market(
    position: &Position,
    reserve: &ReserveSnapshot,
) -> Result<()> {
    require_keys_eq!(
        reserve.lending_market,
        position.market,
        AccrueError::CollateralNotAllowed
    );
    Ok(())
}

pub fn require_borrow_reserve_of_position(
    position: &Position,
    reserve: &ReserveSnapshot,
    borrow_mint: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        reserve.liquidity_mint,
        *borrow_mint,
        AccrueError::CollateralNotAllowed
    );
    require_keys_eq!(
        reserve.lending_market,
        position.market,
        AccrueError::CollateralNotAllowed
    );
    Ok(())
}

pub fn require_treasury_holds_the_borrow_mint(
    treasury: &AccountInfo<'_>,
    borrow_mint: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        token_account_mint(treasury)?,
        *borrow_mint,
        AccrueError::WrongTreasury
    );
    Ok(())
}
