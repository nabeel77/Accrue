use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    INSTRUCTIONS_SYSVAR_ID, KAMINO_LEND_PROGRAM_ID, POSITION_SEED, TOKEN_PROGRAM_ID,
};
use crate::error::AccrueError;
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, token_account_amount, CollateralMovement,
    PositionAccounts,
};
use crate::kamino::cpi::{
    refresh_obligation, refresh_reserve, withdraw_collateral, ObligationContext, ReserveRefresh,
    WithdrawAccounts,
};
use crate::kamino::{read_obligation_account, read_reserve_account};
use crate::state::{Position, PositionState};

#[derive(Accounts)]
pub struct Rescue<'info> {
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
    )]
    pub position: Box<Account<'info, Position>>,

    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub destination_mint: Box<InterfaceAccount<'info, Mint>>,
    pub borrow_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = position.collateral_token_account @ AccrueError::WrongPositionState)]
    pub position_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = position.usdc_token_account @ AccrueError::WrongPositionState)]
    pub position_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = position.destination_token_account @ AccrueError::WrongPositionState)]
    pub position_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = owner,
        associated_token::token_program = collateral_token_program,
    )]
    pub owner_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = borrow_mint,
        associated_token::authority = owner,
        associated_token::token_program = borrow_token_program,
    )]
    pub owner_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = destination_mint,
        associated_token::authority = owner,
        associated_token::token_program = destination_token_program,
    )]
    pub owner_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: owned by the lending market program and matched against the position
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub obligation: UncheckedAccount<'info>,
    /// CHECK: owned by the lending market program and matched against the position
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: the market's own signing authority, derived and checked by the lending market
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: the reserve the collateral sits in, read from the obligation
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub collateral_reserve: UncheckedAccount<'info>,
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_collateral_supply: UncheckedAccount<'info>,
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_collateral_mint: UncheckedAccount<'info>,
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: matched against the price account the collateral entry records in the config
    pub scope_prices: UncheckedAccount<'info>,

    /// CHECK: the lending market program itself, checked against the constants module
    #[account(address = KAMINO_LEND_PROGRAM_ID)]
    pub kamino_program: UncheckedAccount<'info>,
    /// CHECK: read by the lending market to see the other instructions in this transaction
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
    /// CHECK: the lending market mints its collateral tokens under the classic token program
    #[account(address = TOKEN_PROGRAM_ID)]
    pub kamino_collateral_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the collateral mint belongs to
    pub collateral_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program USDC belongs to
    pub borrow_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the destination mint belongs to
    pub destination_token_program: UncheckedAccount<'info>,
}

pub fn handle_rescue(context: Context<Rescue>) -> Result<()> {
    let accounts = &context.accounts;

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

    let position_accounts = PositionAccounts {
        position: accounts.position.to_account_info(),
        collateral_token_account: accounts.position_collateral_account.to_account_info(),
        usdc_token_account: accounts.position_usdc_account.to_account_info(),
        destination_token_account: accounts.position_destination_account.to_account_info(),
        obligation: accounts.obligation.to_account_info(),
    };
    let collateral_reserve_key = accounts.collateral_reserve.key();
    let ledger_before = read_position_ledger(&position_accounts, &collateral_reserve_key)?;

    send_everything_to_owner(accounts, &position_seeds)?;

    let withdrawable = withdrawable_collateral(accounts)?;
    if withdrawable > 0 {
        refresh_reserve(
            &ReserveRefresh {
                reserve: accounts.collateral_reserve.to_account_info(),
                lending_market: accounts.lending_market.to_account_info(),
                scope_prices: accounts.scope_prices.to_account_info(),
            },
            &accounts.kamino_program.to_account_info(),
        )?;
        refresh_obligation(
            &accounts.obligation.to_account_info(),
            &accounts.lending_market.to_account_info(),
            &[accounts.collateral_reserve.to_account_info()],
        )?;

        withdraw_collateral(
            &ObligationContext {
                obligation: accounts.obligation.to_account_info(),
                lending_market: accounts.lending_market.to_account_info(),
                lending_market_authority: accounts.lending_market_authority.to_account_info(),
                position: accounts.position.to_account_info(),
            },
            &WithdrawAccounts {
                reserve: accounts.collateral_reserve.to_account_info(),
                reserve_liquidity_mint: accounts.collateral_mint.to_account_info(),
                reserve_source_collateral: accounts
                    .collateral_reserve_collateral_supply
                    .to_account_info(),
                reserve_collateral_mint: accounts
                    .collateral_reserve_collateral_mint
                    .to_account_info(),
                reserve_liquidity_supply: accounts
                    .collateral_reserve_liquidity_supply
                    .to_account_info(),
                destination_liquidity: accounts.owner_collateral_account.to_account_info(),
                collateral_token_program: accounts
                    .kamino_collateral_token_program
                    .to_account_info(),
                liquidity_token_program: accounts.collateral_token_program.to_account_info(),
                instruction_sysvar: accounts.instruction_sysvar.to_account_info(),
            },
            withdrawable,
            &position_seeds,
        )?;
    }

    assert_invariants_hold(
        &position_accounts,
        &collateral_reserve_key,
        &ledger_before,
        CollateralMovement::ExactlyOut(withdrawable),
        None,
        None,
        None,
    )?;

    let obligation = read_obligation_account(&accounts.obligation.to_account_info())?;
    let position = &mut context.accounts.position;
    position.state = if obligation.has_debt {
        PositionState::Closing
    } else {
        PositionState::Closed
    };

    Ok(())
}

fn withdrawable_collateral(accounts: &Rescue<'_>) -> Result<u64> {
    let reserve = read_reserve_account(&accounts.collateral_reserve)?;
    let obligation = read_obligation_account(&accounts.obligation.to_account_info())?;
    let deposited = obligation.deposited_amount_for_reserve(&accounts.collateral_reserve.key());
    if deposited == 0 {
        return Ok(0);
    }
    if !obligation.has_debt {
        return Ok(deposited);
    }

    let threshold_bps = u128::from(reserve.liquidation_threshold_bps()?);
    if threshold_bps == 0 {
        return Ok(0);
    }
    let debt_value = obligation.borrowed_assets_market_value_scaled;
    let deposited_value = obligation.deposited_value_scaled;
    if deposited_value == 0 {
        return Ok(0);
    }

    let value_that_must_stay = debt_value
        .checked_mul(10_000)
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(threshold_bps)
        .ok_or(AccrueError::MathOverflow)?;
    if value_that_must_stay >= deposited_value {
        return Ok(0);
    }

    let releasable_value = deposited_value
        .checked_sub(value_that_must_stay)
        .ok_or(AccrueError::MathOverflow)?;
    let releasable = u128::from(deposited)
        .checked_mul(releasable_value)
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(deposited_value)
        .ok_or(AccrueError::MathOverflow)?;

    u64::try_from(releasable).map_err(|_| AccrueError::MathOverflow.into())
}

fn send_everything_to_owner(accounts: &Rescue<'_>, position_seeds: &[&[u8]]) -> Result<()> {
    move_whole_balance(
        &accounts.position_destination_account.to_account_info(),
        &accounts.owner_destination_account.to_account_info(),
        &accounts.destination_mint.to_account_info(),
        accounts.destination_mint.decimals,
        &accounts.destination_token_program.to_account_info(),
        &accounts.position.to_account_info(),
        position_seeds,
    )?;
    move_whole_balance(
        &accounts.position_usdc_account.to_account_info(),
        &accounts.owner_usdc_account.to_account_info(),
        &accounts.borrow_mint.to_account_info(),
        accounts.borrow_mint.decimals,
        &accounts.borrow_token_program.to_account_info(),
        &accounts.position.to_account_info(),
        position_seeds,
    )?;
    move_whole_balance(
        &accounts.position_collateral_account.to_account_info(),
        &accounts.owner_collateral_account.to_account_info(),
        &accounts.collateral_mint.to_account_info(),
        accounts.collateral_mint.decimals,
        &accounts.collateral_token_program.to_account_info(),
        &accounts.position.to_account_info(),
        position_seeds,
    )
}

fn move_whole_balance<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    decimals: u8,
    token_program: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let amount = token_account_amount(from)?;
    if amount == 0 {
        return Ok(());
    }
    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            anchor_spl::token_interface::TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: authority.clone(),
            },
            &[position_seeds],
        ),
        amount,
        decimals,
    )
}
