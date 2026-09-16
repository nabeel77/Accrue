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

pub fn require_the_borrow_reserve_the_position_recorded(
    position: &Position,
    reserve_address: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *reserve_address,
        position.borrow_reserve,
        AccrueError::WrongBorrowReserve
    );
    Ok(())
}

pub fn require_the_borrow_mint_the_position_recorded(
    position: &Position,
    borrow_mint: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *borrow_mint,
        position.borrow_mint,
        AccrueError::WrongBorrowReserve
    );
    Ok(())
}

pub fn require_borrow_reserve_of_position(
    position: &Position,
    reserve: &ReserveSnapshot,
    reserve_address: &Pubkey,
    borrow_mint: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *reserve_address,
        position.borrow_reserve,
        AccrueError::WrongBorrowReserve
    );
    require_keys_eq!(
        *borrow_mint,
        position.borrow_mint,
        AccrueError::WrongBorrowReserve
    );
    require_keys_eq!(
        reserve.liquidity_mint,
        position.borrow_mint,
        AccrueError::WrongBorrowReserve
    );
    require_keys_eq!(
        reserve.lending_market,
        position.market,
        AccrueError::WrongBorrowReserve
    );
    Ok(())
}

pub fn require_the_vaults_the_borrow_reserve_names(
    reserve: &ReserveSnapshot,
    liquidity_supply: &Pubkey,
    fee_receiver: Option<&Pubkey>,
) -> Result<()> {
    require_keys_eq!(
        *liquidity_supply,
        reserve.liquidity_supply_vault,
        AccrueError::WrongBorrowReserve
    );
    if let Some(fee_receiver) = fee_receiver {
        require_keys_eq!(
            *fee_receiver,
            reserve.liquidity_fee_vault,
            AccrueError::WrongBorrowReserve
        );
    }
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
