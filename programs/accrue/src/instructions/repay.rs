use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    INSTRUCTIONS_SYSVAR_ID, KAMINO_FARMS_PROGRAM_ID, KAMINO_LEND_PROGRAM_ID, POSITION_SEED,
};
use crate::error::AccrueError;
use crate::instructions::checks::{
    require_borrow_reserve_of_position, require_collateral_reserve_of_position,
    require_the_vaults_the_borrow_reserve_names,
};
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, CollateralMovement, InvariantCheck,
    PositionAccounts, SwapCheck,
};
use crate::kamino::cpi::{
    farm_accounts_for_reserve, refresh_obligation, refresh_reserve, repay_liquidity,
    ObligationContext, RepayAccounts, ReserveRefresh,
};
use crate::kamino::{
    read_obligation_borrowed_amount_scaled, read_reserve_account,
    scaled_fraction_to_whole_units_rounding_up,
};
use crate::state::{Position, PositionSigner};

#[derive(Accounts)]
pub struct Repay<'info> {
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

    pub borrow_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = position.collateral_token_account @ AccrueError::WrongPositionState)]
    pub position_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = position.usdc_token_account @ AccrueError::WrongPositionState)]
    pub position_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = position.destination_token_account @ AccrueError::WrongPositionState)]
    pub position_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = borrow_mint,
        associated_token::authority = owner,
        associated_token::token_program = borrow_token_program,
    )]
    pub owner_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: matched against the obligation recorded on the position
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub obligation: UncheckedAccount<'info>,
    /// CHECK: matched against the market recorded on the position
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID, address = position.market @ AccrueError::CollateralNotAllowed)]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: the market's own signing authority, derived and checked by the lending market
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: checked against the position's collateral mint and market before it is used
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub collateral_reserve: UncheckedAccount<'info>,
    /// CHECK: checked against the borrow mint and the position's market before it is used
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub borrow_reserve: UncheckedAccount<'info>,
    /// CHECK: read from the borrow reserve and passed to the lending market unchanged
    #[account(mut)]
    pub borrow_reserve_liquidity_supply: UncheckedAccount<'info>,

    /// CHECK: matched against the farm the borrow reserve names, absent when it names none
    #[account(mut)]
    pub borrow_reserve_farm_state: Option<UncheckedAccount<'info>>,
    /// CHECK: this position's stake in that farm, owned by the farms program
    #[account(mut)]
    pub borrow_obligation_farm_state: Option<UncheckedAccount<'info>>,

    /// CHECK: matched against the price account the collateral reserve names
    pub collateral_scope_prices: UncheckedAccount<'info>,
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
    /// CHECK: the token program the borrow mint belongs to, read from the reserve
    pub borrow_token_program: UncheckedAccount<'info>,
}

pub fn handle_repay(context: Context<Repay>, requested_amount: u64) -> Result<()> {
    let accounts = &context.accounts;
    accounts.position.require_not_closed()?;
    require!(requested_amount > 0, AccrueError::PositionSizeOutOfRange);

    let borrow_reserve = read_reserve_account(&accounts.borrow_reserve)?;
    require_borrow_reserve_of_position(
        &accounts.position,
        &borrow_reserve,
        &accounts.borrow_reserve.key(),
        &accounts.borrow_mint.key(),
    )?;
    require_the_vaults_the_borrow_reserve_names(
        &borrow_reserve,
        &accounts.borrow_reserve_liquidity_supply.key(),
        None,
    )?;
    require_keys_eq!(
        accounts.borrow_token_program.key(),
        borrow_reserve.liquidity_token_program,
        AccrueError::UnknownTokenProgram
    );
    require_keys_eq!(
        accounts.borrow_scope_prices.key(),
        borrow_reserve.scope_price_account()?,
        AccrueError::CollateralNotAllowed
    );

    let collateral_reserve = read_reserve_account(&accounts.collateral_reserve)?;
    require_collateral_reserve_of_position(&accounts.position, &collateral_reserve)?;
    require_keys_eq!(
        accounts.collateral_scope_prices.key(),
        collateral_reserve.scope_price_account()?,
        AccrueError::CollateralNotAllowed
    );

    refresh_reserve(
        &ReserveRefresh {
            reserve: accounts.collateral_reserve.to_account_info(),
            lending_market: accounts.lending_market.to_account_info(),
            scope_prices: accounts.collateral_scope_prices.to_account_info(),
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

    let borrow_reserve_key = accounts.borrow_reserve.key();
    let debt_now =
        scaled_fraction_to_whole_units_rounding_up(read_obligation_borrowed_amount_scaled(
            &accounts.obligation.to_account_info(),
            &borrow_reserve_key,
        )?);
    let debt_now = u64::try_from(debt_now).map_err(|_| AccrueError::MathOverflow)?;
    require!(debt_now > 0, AccrueError::WrongPositionState);

    let repay_amount = requested_amount.min(debt_now);

    let collateral_reserve_key = accounts.collateral_reserve.key();
    let position_accounts = PositionAccounts {
        position: accounts.position.to_account_info(),
        collateral_token_account: accounts.position_collateral_account.to_account_info(),
        usdc_token_account: accounts.position_usdc_account.to_account_info(),
        destination_token_account: accounts.position_destination_account.to_account_info(),
        obligation: accounts.obligation.to_account_info(),
    };
    let ledger_before = read_position_ledger(&position_accounts, &collateral_reserve_key)?;

    anchor_spl::token_interface::transfer_checked(
        CpiContext::new(
            accounts.borrow_token_program.key(),
            anchor_spl::token_interface::TransferChecked {
                from: accounts.owner_usdc_account.to_account_info(),
                mint: accounts.borrow_mint.to_account_info(),
                to: accounts.position_usdc_account.to_account_info(),
                authority: accounts.owner.to_account_info(),
            },
        ),
        repay_amount,
        accounts.borrow_mint.decimals,
    )?;

    let signer = PositionSigner::for_position(&accounts.position);
    let position_seeds = signer.seeds();

    let farms = farm_accounts_for_reserve(
        borrow_reserve.farm_debt,
        accounts
            .borrow_reserve_farm_state
            .as_ref()
            .map(|account| account.to_account_info()),
        accounts
            .borrow_obligation_farm_state
            .as_ref()
            .map(|account| account.to_account_info()),
        accounts.farms_program.to_account_info(),
    )?;

    repay_liquidity(
        &ObligationContext {
            obligation: accounts.obligation.to_account_info(),
            lending_market: accounts.lending_market.to_account_info(),
            lending_market_authority: accounts.lending_market_authority.to_account_info(),
            position: accounts.position.to_account_info(),
            kamino_program: accounts.kamino_program.to_account_info(),
        },
        &RepayAccounts {
            reserve: accounts.borrow_reserve.to_account_info(),
            reserve_liquidity_mint: accounts.borrow_mint.to_account_info(),
            reserve_destination_liquidity: accounts
                .borrow_reserve_liquidity_supply
                .to_account_info(),
            source_liquidity: accounts.position_usdc_account.to_account_info(),
            token_program: accounts.borrow_token_program.to_account_info(),
            instruction_sysvar: accounts.instruction_sysvar.to_account_info(),
        },
        &farms,
        repay_amount,
        &position_seeds,
    )?;

    assert_invariants_hold(&InvariantCheck {
        accounts: &position_accounts,
        collateral_reserve: &collateral_reserve_key,
        before: &ledger_before,
        collateral_movement: CollateralMovement::MustNotMove,
        swap: SwapCheck::NoSwapInThisInstruction,
    })?;

    context.accounts.position.record_repay(repay_amount)?;
    Ok(())
}
