use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::{CONFIG_SEED, KAMINO_LEND_PROGRAM_ID, POSITION_SEED};
use crate::error::AccrueError;
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, token_account_amount, CollateralMovement,
    PositionAccounts,
};
use crate::state::{Config, Position, PositionState};
use crate::swap::{execute_jupiter_swap, JupiterSwap};

#[derive(Accounts)]
pub struct BuyDestination<'info> {
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

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

    #[account(
        mut,
        address = position.collateral_token_account @ AccrueError::WrongPositionState,
    )]
    pub position_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = position.usdc_token_account @ AccrueError::WrongPositionState)]
    pub position_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = position.destination_token_account @ AccrueError::WrongPositionState,
    )]
    pub position_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: matched against the obligation recorded on the position
    #[account(owner = KAMINO_LEND_PROGRAM_ID)]
    pub obligation: UncheckedAccount<'info>,

    /// CHECK: matched against the reserve recorded for this collateral in the config
    #[account(owner = KAMINO_LEND_PROGRAM_ID)]
    pub collateral_reserve: UncheckedAccount<'info>,
}

pub fn handle_buy_destination<'info>(
    context: Context<'info, BuyDestination<'info>>,
    minimum_destination_amount: u64,
    jupiter_route_data: Vec<u8>,
) -> Result<()> {
    let accounts = &context.accounts;
    accounts
        .position
        .require_state(PositionState::AwaitingSwap)?;

    let collateral_entry = accounts
        .config
        .enabled_collateral_entry(&accounts.position.collateral_mint)?;
    require_keys_eq!(
        accounts.collateral_reserve.key(),
        collateral_entry.reserve,
        AccrueError::CollateralNotAllowed
    );

    let usdc_to_spend = token_account_amount(&accounts.position_usdc_account.to_account_info())?;
    require!(usdc_to_spend > 0, AccrueError::NothingToSwap);
    require!(
        minimum_destination_amount > 0,
        AccrueError::MinimumOutputTooLow
    );

    let position_accounts = PositionAccounts {
        position: accounts.position.to_account_info(),
        collateral_token_account: accounts.position_collateral_account.to_account_info(),
        usdc_token_account: accounts.position_usdc_account.to_account_info(),
        destination_token_account: accounts.position_destination_account.to_account_info(),
        obligation: accounts.obligation.to_account_info(),
    };
    let ledger_before = read_position_ledger(&position_accounts, &collateral_entry.reserve)?;

    let owner_key = accounts.owner.key();
    let collateral_mint_key = accounts.position.collateral_mint;
    let destination_mint_key = accounts.position.destination_mint;
    let position_bump = [accounts.position.bump];
    let position_seeds: [&[u8]; 5] = [
        POSITION_SEED,
        owner_key.as_ref(),
        collateral_mint_key.as_ref(),
        destination_mint_key.as_ref(),
        &position_bump,
    ];

    let swapped = execute_jupiter_swap(
        &JupiterSwap {
            source: accounts.position_usdc_account.to_account_info(),
            destination: accounts.position_destination_account.to_account_info(),
            amount_in: usdc_to_spend,
            minimum_out: minimum_destination_amount,
        },
        &position_accounts,
        context.remaining_accounts,
        &jupiter_route_data,
        &position_seeds,
    )?;

    assert_invariants_hold(
        &position_accounts,
        &collateral_entry.reserve,
        &ledger_before,
        CollateralMovement::MustNotMove,
        Some(swapped),
        Some(&accounts.position_usdc_account.key()),
        Some(&accounts.position_destination_account.key()),
    )?;

    context.accounts.position.state = PositionState::Open;
    Ok(())
}
