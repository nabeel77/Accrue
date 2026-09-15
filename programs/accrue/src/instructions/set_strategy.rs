use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::{KAMINO_LEND_PROGRAM_ID, POSITION_SEED};
use crate::error::AccrueError;
use crate::instructions::checks::require_collateral_reserve_of_position;
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, CollateralMovement, InvariantCheck,
    PositionAccounts, SwapCheck,
};
use crate::kamino::read_reserve_account;
use crate::state::{Position, Strategy};

#[derive(Accounts)]
pub struct SetStrategy<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [
            POSITION_SEED,
            owner.key().as_ref(),
            position.collateral_mint.as_ref(),
            position.destination_mint.as_ref(),
        ],
        bump = position.bump,
        has_one = owner @ AccrueError::NotThePositionOwner,
        has_one = obligation @ AccrueError::WrongPositionState,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(address = position.collateral_token_account @ AccrueError::WrongPositionState)]
    pub position_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = position.usdc_token_account @ AccrueError::WrongPositionState)]
    pub position_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = position.destination_token_account @ AccrueError::WrongPositionState)]
    pub position_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: matched against the obligation recorded on the position
    #[account(owner = KAMINO_LEND_PROGRAM_ID)]
    pub obligation: UncheckedAccount<'info>,
    /// CHECK: checked against the position's collateral mint and market before it is read
    #[account(owner = KAMINO_LEND_PROGRAM_ID)]
    pub collateral_reserve: UncheckedAccount<'info>,
}

pub fn handle_set_strategy(context: Context<SetStrategy>, strategy: Strategy) -> Result<()> {
    let accounts = &context.accounts;
    accounts.position.require_not_closed()?;

    let collateral_reserve = read_reserve_account(&accounts.collateral_reserve)?;
    require_collateral_reserve_of_position(&accounts.position, &collateral_reserve)?;

    strategy.validate_against_reserve(
        collateral_reserve.max_loan_to_value_bps()?,
        collateral_reserve.liquidation_threshold_bps()?,
    )?;

    let collateral_reserve_key = accounts.collateral_reserve.key();
    let position_accounts = PositionAccounts {
        position: accounts.position.to_account_info(),
        collateral_token_account: accounts.position_collateral_account.to_account_info(),
        usdc_token_account: accounts.position_usdc_account.to_account_info(),
        destination_token_account: accounts.position_destination_account.to_account_info(),
        obligation: accounts.obligation.to_account_info(),
    };
    let ledger_before = read_position_ledger(&position_accounts, &collateral_reserve_key)?;

    context.accounts.position.strategy = strategy;

    assert_invariants_hold(&InvariantCheck {
        accounts: &position_accounts,
        collateral_reserve: &collateral_reserve_key,
        before: &ledger_before,
        collateral_movement: CollateralMovement::MustNotMove,
        swap: SwapCheck::NoSwapInThisInstruction,
    })?;

    Ok(())
}
