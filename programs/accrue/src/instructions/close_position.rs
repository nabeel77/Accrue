use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::{KAMINO_LEND_PROGRAM_ID, POSITION_SEED};
use crate::error::AccrueError;
use crate::instructions::checks::require_collateral_reserve_of_position;
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, CollateralMovement, InvariantCheck,
    PositionAccounts, SwapCheck,
};
use crate::kamino::{
    read_obligation_deposited_amount, read_obligation_has_debt, read_reserve_account,
};
use crate::state::{Position, PositionSigner};

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
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
        close = owner,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(mut, address = position.collateral_token_account @ AccrueError::WrongPositionState)]
    pub position_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = position.usdc_token_account @ AccrueError::WrongPositionState)]
    pub position_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = position.destination_token_account @ AccrueError::WrongPositionState)]
    pub position_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: matched against the obligation recorded on the position
    pub obligation: UncheckedAccount<'info>,
    /// CHECK: checked against the position's collateral mint and market before it is read
    #[account(owner = KAMINO_LEND_PROGRAM_ID)]
    pub collateral_reserve: UncheckedAccount<'info>,

    /// CHECK: the token program the collateral mint belongs to, read from the reserve
    pub collateral_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the borrow mint belongs to
    pub borrow_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the destination mint belongs to
    pub destination_token_program: UncheckedAccount<'info>,
}

pub fn handle_close_position(context: Context<ClosePosition>) -> Result<()> {
    let accounts = &context.accounts;

    let collateral_reserve = read_reserve_account(&accounts.collateral_reserve)?;
    require_collateral_reserve_of_position(&accounts.position, &collateral_reserve)?;

    require!(
        !read_obligation_has_debt(&accounts.obligation.to_account_info())?,
        AccrueError::DebtStillOutstanding
    );
    require!(
        read_obligation_deposited_amount(
            &accounts.obligation.to_account_info(),
            &accounts.collateral_reserve.key(),
        )? == 0,
        AccrueError::TokensStillHeld
    );

    let collateral_reserve_key = accounts.collateral_reserve.key();
    let position_accounts = PositionAccounts {
        position: accounts.position.to_account_info(),
        collateral_token_account: accounts.position_collateral_account.to_account_info(),
        usdc_token_account: accounts.position_usdc_account.to_account_info(),
        destination_token_account: accounts.position_destination_account.to_account_info(),
        obligation: accounts.obligation.to_account_info(),
    };
    let ledger = read_position_ledger(&position_accounts, &collateral_reserve_key)?;
    require!(
        ledger.collateral_balance == 0
            && ledger.usdc_balance == 0
            && ledger.destination_balance == 0,
        AccrueError::TokensStillHeld
    );

    assert_invariants_hold(&InvariantCheck {
        accounts: &position_accounts,
        collateral_reserve: &collateral_reserve_key,
        before: &ledger,
        collateral_movement: CollateralMovement::MustNotMove,
        swap: SwapCheck::NoSwapInThisInstruction,
    })?;

    let signer = PositionSigner::for_position(&accounts.position);
    let position_seeds = signer.seeds();

    close_token_account(
        &accounts.position_destination_account.to_account_info(),
        &accounts.destination_token_program.to_account_info(),
        accounts,
        &position_seeds,
    )?;
    close_token_account(
        &accounts.position_usdc_account.to_account_info(),
        &accounts.borrow_token_program.to_account_info(),
        accounts,
        &position_seeds,
    )?;
    close_token_account(
        &accounts.position_collateral_account.to_account_info(),
        &accounts.collateral_token_program.to_account_info(),
        accounts,
        &position_seeds,
    )
}

fn close_token_account<'info>(
    token_account: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    accounts: &ClosePosition<'info>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    anchor_spl::token_interface::close_account(CpiContext::new_with_signer(
        token_program.key(),
        anchor_spl::token_interface::CloseAccount {
            account: token_account.clone(),
            destination: accounts.owner.to_account_info(),
            authority: accounts.position.to_account_info(),
        },
        &[position_seeds],
    ))
}
