use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    INSTRUCTIONS_SYSVAR_ID, KAMINO_FARMS_PROGRAM_ID, KAMINO_LEND_PROGRAM_ID, POSITION_SEED,
    TOKEN_PROGRAM_ID,
};
use crate::error::AccrueError;
use crate::instructions::checks::{
    require_the_borrow_mint_the_position_recorded, require_the_borrow_reserve_the_position_recorded,
};
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, token_account_amount, CollateralMovement,
    InvariantCheck, PositionAccounts, SwapCheck,
};
use crate::kamino::cpi::{
    farm_accounts_for_reserve, refresh_obligation, refresh_reserve, withdraw_collateral,
    ObligationContext, ReserveRefresh, WithdrawAccounts,
};
use crate::kamino::{
    obligation_was_closed_by_the_market, read_obligation_adjusted_debt_value_scaled,
    read_obligation_deposited_amount, read_obligation_deposited_value_scaled,
    read_obligation_has_debt, read_reserve_account,
};
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

    /// CHECK: matched against the obligation recorded on the position
    #[account(mut)]
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
    /// CHECK: matched against the farm the collateral reserve names, absent when it names none
    #[account(mut)]
    pub collateral_reserve_farm_state: Option<UncheckedAccount<'info>>,
    /// CHECK: this position's stake in that farm, owned by the farms program
    #[account(mut)]
    pub collateral_obligation_farm_state: Option<UncheckedAccount<'info>>,
    /// CHECK: the other reserve the obligation names, refreshed so the obligation can be read
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub borrow_reserve: UncheckedAccount<'info>,
    /// CHECK: matched against the price account the collateral reserve names
    pub scope_prices: UncheckedAccount<'info>,
    /// CHECK: matched against the price account the borrow reserve names
    pub borrow_scope_prices: UncheckedAccount<'info>,

    /// CHECK: the farms program the lending market stakes through, from the constants module
    #[account(address = KAMINO_FARMS_PROGRAM_ID)]
    pub farms_program: UncheckedAccount<'info>,

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

    require_the_borrow_reserve_the_position_recorded(
        &accounts.position,
        &accounts.borrow_reserve.key(),
    )?;
    require_the_borrow_mint_the_position_recorded(&accounts.position, &accounts.borrow_mint.key())?;

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

    send_the_loose_tokens_to_the_owner(accounts, &position_seeds)?;

    let obligation_info = accounts.obligation.to_account_info();
    let has_a_deposit = !obligation_was_closed_by_the_market(&obligation_info)
        && read_obligation_deposited_amount(&obligation_info, &collateral_reserve_key)? > 0;

    let mut withdrawable = 0;
    if has_a_deposit {
        refresh_reserve(
            &ReserveRefresh {
                reserve: accounts.collateral_reserve.to_account_info(),
                lending_market: accounts.lending_market.to_account_info(),
                scope_prices: accounts.scope_prices.to_account_info(),
            },
            &accounts.kamino_program.to_account_info(),
        )?;
        refresh_reserve(
            &ReserveRefresh {
                reserve: accounts.borrow_reserve.to_account_info(),
                lending_market: accounts.lending_market.to_account_info(),
                scope_prices: accounts.borrow_scope_prices.to_account_info(),
            },
            &accounts.kamino_program.to_account_info(),
        )?;
        refresh_obligation(
            &accounts.obligation.to_account_info(),
            &accounts.lending_market.to_account_info(),
            &[
                accounts.collateral_reserve.to_account_info(),
                accounts.borrow_reserve.to_account_info(),
            ],
        )?;

        withdrawable = withdrawable_collateral(accounts)?;
    }

    if withdrawable > 0 {
        let collateral_farms = farm_accounts_for_reserve(
            read_reserve_account(&accounts.collateral_reserve)?.farm_collateral,
            accounts
                .collateral_reserve_farm_state
                .as_ref()
                .map(|account| account.to_account_info()),
            accounts
                .collateral_obligation_farm_state
                .as_ref()
                .map(|account| account.to_account_info()),
            accounts.farms_program.to_account_info(),
        )?;

        withdraw_collateral(
            &ObligationContext {
                obligation: accounts.obligation.to_account_info(),
                lending_market: accounts.lending_market.to_account_info(),
                lending_market_authority: accounts.lending_market_authority.to_account_info(),
                position: accounts.position.to_account_info(),
                kamino_program: accounts.kamino_program.to_account_info(),
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
                destination_liquidity: accounts.position_collateral_account.to_account_info(),
                collateral_token_program: accounts
                    .kamino_collateral_token_program
                    .to_account_info(),
                liquidity_token_program: accounts.collateral_token_program.to_account_info(),
                instruction_sysvar: accounts.instruction_sysvar.to_account_info(),
            },
            &collateral_farms,
            withdrawable,
            &position_seeds,
        )?;
    }

    move_whole_balance(
        &accounts.position_collateral_account.to_account_info(),
        &accounts.owner_collateral_account.to_account_info(),
        &accounts.collateral_mint.to_account_info(),
        accounts.collateral_mint.decimals,
        &accounts.collateral_token_program.to_account_info(),
        &accounts.position.to_account_info(),
        &position_seeds,
    )?;

    assert_invariants_hold(&InvariantCheck {
        accounts: &position_accounts,
        collateral_reserve: &collateral_reserve_key,
        before: &ledger_before,
        collateral_movement: CollateralMovement::ExactlyOut(withdrawable),
        swap: SwapCheck::NoSwapInThisInstruction,
    })?;

    let still_owes = read_obligation_has_debt(&accounts.obligation.to_account_info())?;
    let position = &mut context.accounts.position;
    position.state = if still_owes {
        PositionState::Closing
    } else {
        PositionState::Closed
    };

    Ok(())
}

fn withdrawable_collateral(accounts: &Rescue<'_>) -> Result<u64> {
    let obligation = accounts.obligation.to_account_info();
    let deposited =
        read_obligation_deposited_amount(&obligation, &accounts.collateral_reserve.key())?;
    if deposited == 0 {
        return Ok(0);
    }
    if !read_obligation_has_debt(&obligation)? {
        return Ok(deposited);
    }

    let max_loan_to_value_bps =
        u128::from(read_reserve_account(&accounts.collateral_reserve)?.max_loan_to_value_bps()?);
    if max_loan_to_value_bps == 0 {
        return Ok(0);
    }
    let debt_value = read_obligation_adjusted_debt_value_scaled(&obligation)?;
    let deposited_value = read_obligation_deposited_value_scaled(&obligation)?;
    if deposited_value == 0 {
        return Ok(0);
    }

    let value_that_must_stay = divide_rounding_up(
        debt_value
            .checked_mul(10_000)
            .ok_or(AccrueError::MathOverflow)?,
        max_loan_to_value_bps,
    )?;
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

fn divide_rounding_up(numerator: u128, denominator: u128) -> Result<u128> {
    let quotient = numerator
        .checked_div(denominator)
        .ok_or(AccrueError::MathOverflow)?;
    let remainder = numerator
        .checked_rem(denominator)
        .ok_or(AccrueError::MathOverflow)?;
    if remainder == 0 {
        Ok(quotient)
    } else {
        quotient
            .checked_add(1)
            .ok_or(AccrueError::MathOverflow.into())
    }
}

fn send_the_loose_tokens_to_the_owner(
    accounts: &Rescue<'_>,
    position_seeds: &[&[u8]],
) -> Result<()> {
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
