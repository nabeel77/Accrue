use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    INSTRUCTIONS_SYSVAR_ID, KAMINO_FARMS_PROGRAM_ID, KAMINO_LEND_PROGRAM_ID, POSITION_SEED,
    TOKEN_PROGRAM_ID,
};
use crate::error::AccrueError;
use crate::instructions::checks::{
    require_collateral_reserve_of_position, require_reserve_on_the_positions_market,
};
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, CollateralMovement, InvariantCheck,
    PositionAccounts, SwapCheck,
};
use crate::kamino::cpi::{
    deposit_collateral, farm_accounts_for_reserve, refresh_obligation, refresh_reserve,
    DepositAccounts, ObligationContext, ReserveRefresh,
};
use crate::kamino::{read_obligation_deposited_amount, read_reserve_account};
use crate::state::{Position, PositionSigner};

#[derive(Accounts)]
pub struct AddCollateral<'info> {
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

    #[account(address = position.collateral_mint @ AccrueError::CollateralNotAllowed)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

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
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_collateral_mint: UncheckedAccount<'info>,
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_collateral_supply: UncheckedAccount<'info>,

    /// CHECK: the other reserve the obligation names, refreshed so the obligation can be read
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub borrow_reserve: UncheckedAccount<'info>,

    /// CHECK: matched against the farm the collateral reserve names, absent when it names none
    #[account(mut)]
    pub collateral_reserve_farm_state: Option<UncheckedAccount<'info>>,
    /// CHECK: this position's stake in that farm, owned by the farms program
    #[account(mut)]
    pub collateral_obligation_farm_state: Option<UncheckedAccount<'info>>,

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
    /// CHECK: the token program the collateral mint belongs to, read from the reserve
    pub collateral_token_program: UncheckedAccount<'info>,
}

pub fn handle_add_collateral(
    context: Context<AddCollateral>,
    collateral_amount: u64,
) -> Result<()> {
    let accounts = &context.accounts;
    accounts.position.require_not_closed()?;
    require!(collateral_amount > 0, AccrueError::PositionSizeOutOfRange);

    let collateral_reserve = read_reserve_account(&accounts.collateral_reserve)?;
    require_collateral_reserve_of_position(&accounts.position, &collateral_reserve)?;
    require_keys_eq!(
        accounts.collateral_token_program.key(),
        collateral_reserve.liquidity_token_program,
        AccrueError::UnknownTokenProgram
    );
    require_keys_eq!(
        accounts.scope_prices.key(),
        collateral_reserve.scope_price_account()?,
        AccrueError::CollateralNotAllowed
    );

    let borrow_reserve = read_reserve_account(&accounts.borrow_reserve)?;
    require_reserve_on_the_positions_market(&accounts.position, &borrow_reserve)?;
    require_keys_eq!(
        accounts.borrow_scope_prices.key(),
        borrow_reserve.scope_price_account()?,
        AccrueError::CollateralNotAllowed
    );

    let signer = PositionSigner::for_position(&accounts.position);
    let position_seeds = signer.seeds();
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
            accounts.collateral_token_program.key(),
            anchor_spl::token_interface::TransferChecked {
                from: accounts.owner_collateral_account.to_account_info(),
                mint: accounts.collateral_mint.to_account_info(),
                to: accounts.position_collateral_account.to_account_info(),
                authority: accounts.owner.to_account_info(),
            },
        ),
        collateral_amount,
        accounts.collateral_mint.decimals,
    )?;

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

    let farms = farm_accounts_for_reserve(
        collateral_reserve.farm_collateral,
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

    deposit_collateral(
        &ObligationContext {
            obligation: accounts.obligation.to_account_info(),
            lending_market: accounts.lending_market.to_account_info(),
            lending_market_authority: accounts.lending_market_authority.to_account_info(),
            position: accounts.position.to_account_info(),
            kamino_program: accounts.kamino_program.to_account_info(),
        },
        &DepositAccounts {
            reserve: accounts.collateral_reserve.to_account_info(),
            reserve_liquidity_mint: accounts.collateral_mint.to_account_info(),
            reserve_liquidity_supply: accounts
                .collateral_reserve_liquidity_supply
                .to_account_info(),
            reserve_collateral_mint: accounts
                .collateral_reserve_collateral_mint
                .to_account_info(),
            reserve_destination_deposit_collateral: accounts
                .collateral_reserve_collateral_supply
                .to_account_info(),
            source_liquidity: accounts.position_collateral_account.to_account_info(),
            collateral_token_program: accounts.kamino_collateral_token_program.to_account_info(),
            liquidity_token_program: accounts.collateral_token_program.to_account_info(),
            instruction_sysvar: accounts.instruction_sysvar.to_account_info(),
        },
        &farms,
        collateral_amount,
        &position_seeds,
    )?;

    let deposited_now = read_obligation_deposited_amount(
        &accounts.obligation.to_account_info(),
        &collateral_reserve_key,
    )?;
    let collateral_added = deposited_now
        .checked_sub(ledger_before.obligation_collateral)
        .ok_or(AccrueError::ObligationCollateralMoved)?;

    assert_invariants_hold(&InvariantCheck {
        accounts: &position_accounts,
        collateral_reserve: &collateral_reserve_key,
        before: &ledger_before,
        collateral_movement: CollateralMovement::ExactlyIn(collateral_added),
        swap: SwapCheck::NoSwapInThisInstruction,
    })?;

    Ok(())
}
