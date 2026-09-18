use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    BASIS_POINTS_DENOMINATOR, CONFIG_SEED, INSTRUCTIONS_SYSVAR_ID, JUPITER_V6_PROGRAM_ID,
    KAMINO_FARMS_PROGRAM_ID, KAMINO_LEND_PROGRAM_ID, POSITION_SEED, TOKEN_PROGRAM_ID,
};
use crate::error::AccrueError;
use crate::guard::require_borrow_within_available_share;
use crate::instructions::checks::{
    require_collateral_reserve_of_position, require_the_borrow_reserve_the_position_recorded,
    require_the_vaults_the_borrow_reserve_names,
};
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, CollateralMovement, InvariantCheck,
    PositionAccounts, SwapCheck,
};
use crate::kamino::cpi::{
    borrow_liquidity, deposit_collateral, farm_accounts_for_reserve, refresh_obligation,
    refresh_reserve, BorrowAccounts, DepositAccounts, ObligationContext, ReserveRefresh,
};
use crate::kamino::{
    read_obligation_adjusted_debt_value_scaled, read_obligation_deposited_amount,
    read_obligation_deposited_value_scaled, read_reserve_account, scaled_fraction_to_whole_units,
};
use crate::state::{Config, Position, PositionSigner, PositionState};
use crate::swap::{execute_jupiter_swap, JupiterSwap};

#[derive(Accounts)]
pub struct TopUp<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

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
    #[account(address = position.destination_mint @ AccrueError::DestinationNotAllowed)]
    pub destination_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = position.borrow_mint @ AccrueError::WrongBorrowReserve)]
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

    /// CHECK: matched against the borrow reserve recorded on the position
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub borrow_reserve: UncheckedAccount<'info>,
    /// CHECK: read from the borrow reserve and checked against the vaults it names
    #[account(mut)]
    pub borrow_reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: read from the borrow reserve and checked against the receiver it names
    #[account(mut)]
    pub borrow_reserve_fee_receiver: UncheckedAccount<'info>,

    /// CHECK: matched against the farm the collateral reserve names, absent when it names none
    #[account(mut)]
    pub collateral_reserve_farm_state: Option<UncheckedAccount<'info>>,
    /// CHECK: this position's stake in that farm, owned by the farms program
    #[account(mut)]
    pub collateral_obligation_farm_state: Option<UncheckedAccount<'info>>,
    /// CHECK: matched against the farm the borrow reserve names, absent when it names none
    #[account(mut)]
    pub borrow_reserve_farm_state: Option<UncheckedAccount<'info>>,
    /// CHECK: this position's stake in that farm, owned by the farms program
    #[account(mut)]
    pub borrow_obligation_farm_state: Option<UncheckedAccount<'info>>,

    /// CHECK: matched against the price account the collateral reserve names
    pub scope_prices: UncheckedAccount<'info>,
    /// CHECK: matched against the price account the borrow reserve names
    pub borrow_scope_prices: UncheckedAccount<'info>,

    /// CHECK: the farms program the lending market stakes through, from the constants module
    #[account(address = KAMINO_FARMS_PROGRAM_ID)]
    pub farms_program: UncheckedAccount<'info>,
    /// CHECK: the swap router itself, checked against the constants module
    #[account(address = JUPITER_V6_PROGRAM_ID)]
    pub swap_program: UncheckedAccount<'info>,
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
    /// CHECK: the token program the borrow mint belongs to, read from the reserve
    pub borrow_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the destination mint belongs to, checked against the config
    pub destination_token_program: UncheckedAccount<'info>,
}

// Growing a position that is already open: more stock in, more borrowed against it, the USDC
// swapped into the same destination. The strategy is never touched, so the guard keeps its levels.
pub fn handle_top_up<'info>(
    context: Context<'info, TopUp<'info>>,
    collateral_amount: u64,
    borrow_amount: u64,
    minimum_destination_amount: u64,
    leave_usdc_for_later_swap: bool,
    jupiter_route_data: Vec<u8>,
) -> Result<()> {
    let accounts = &context.accounts;
    let plan = check_everything_before_any_token_moves(
        accounts,
        collateral_amount,
        borrow_amount,
        minimum_destination_amount,
        leave_usdc_for_later_swap,
    )?;

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

    refresh_everything(accounts)?;

    let collateral_farms = farm_accounts_for_reserve(
        plan.collateral_farm,
        optional_account_info(&accounts.collateral_reserve_farm_state),
        optional_account_info(&accounts.collateral_obligation_farm_state),
        accounts.farms_program.to_account_info(),
    )?;
    let borrow_farms = farm_accounts_for_reserve(
        plan.borrow_farm,
        optional_account_info(&accounts.borrow_reserve_farm_state),
        optional_account_info(&accounts.borrow_obligation_farm_state),
        accounts.farms_program.to_account_info(),
    )?;

    let obligation_context = ObligationContext {
        obligation: accounts.obligation.to_account_info(),
        lending_market: accounts.lending_market.to_account_info(),
        lending_market_authority: accounts.lending_market_authority.to_account_info(),
        position: accounts.position.to_account_info(),
        kamino_program: accounts.kamino_program.to_account_info(),
    };

    deposit_collateral(
        &obligation_context,
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
        &collateral_farms,
        collateral_amount,
        &position_seeds,
    )?;

    // The market values the whole obligation only when it is refreshed, and the size limit below
    // reads those values, so both reserves and the obligation are refreshed again here.
    refresh_everything(accounts)?;
    require_the_whole_position_is_within_its_size_limit(accounts)?;

    borrow_liquidity(
        &obligation_context,
        &BorrowAccounts {
            reserve: accounts.borrow_reserve.to_account_info(),
            reserve_liquidity_mint: accounts.borrow_mint.to_account_info(),
            reserve_source_liquidity: accounts.borrow_reserve_liquidity_supply.to_account_info(),
            fee_receiver: accounts.borrow_reserve_fee_receiver.to_account_info(),
            destination_liquidity: accounts.position_usdc_account.to_account_info(),
            token_program: accounts.borrow_token_program.to_account_info(),
            instruction_sysvar: accounts.instruction_sysvar.to_account_info(),
        },
        &borrow_farms,
        borrow_amount,
        &position_seeds,
    )?;

    require_the_borrow_landed_at_or_under_target(accounts)?;

    let deposited_now = read_obligation_deposited_amount(
        &accounts.obligation.to_account_info(),
        &collateral_reserve_key,
    )?;
    let collateral_added = deposited_now
        .checked_sub(ledger_before.obligation_collateral)
        .ok_or(AccrueError::ObligationCollateralMoved)?;

    let swap = if leave_usdc_for_later_swap {
        SwapCheck::NoSwapInThisInstruction
    } else {
        let bounds = execute_jupiter_swap(
            &JupiterSwap {
                source: accounts.position_usdc_account.to_account_info(),
                destination: accounts.position_destination_account.to_account_info(),
                swap_program: accounts.swap_program.to_account_info(),
                amount_in: borrow_amount,
                minimum_out: minimum_destination_amount,
            },
            &position_accounts,
            context.remaining_accounts,
            &jupiter_route_data,
            &position_seeds,
        )?;
        SwapCheck::EndsWithAtLeast {
            source: accounts.position_usdc_account.key(),
            destination: accounts.position_destination_account.key(),
            bounds,
        }
    };

    assert_invariants_hold(&InvariantCheck {
        accounts: &position_accounts,
        collateral_reserve: &collateral_reserve_key,
        before: &ledger_before,
        collateral_movement: CollateralMovement::ExactlyIn(collateral_added),
        swap,
    })?;

    let position = &mut context.accounts.position;
    position.record_borrow(borrow_amount)?;
    if leave_usdc_for_later_swap {
        position.state = PositionState::AwaitingSwap;
    }

    Ok(())
}

struct TopUpPlan {
    collateral_farm: Pubkey,
    borrow_farm: Pubkey,
}

#[inline(never)]
fn check_everything_before_any_token_moves(
    accounts: &TopUp<'_>,
    collateral_amount: u64,
    borrow_amount: u64,
    minimum_destination_amount: u64,
    leave_usdc_for_later_swap: bool,
) -> Result<TopUpPlan> {
    accounts
        .position
        .require_state(PositionState::Open)
        .map_err(|_| AccrueError::WrongPositionState)?;
    accounts.config.require_opens_allowed()?;

    let collateral_entry = accounts
        .config
        .enabled_collateral_entry(&accounts.position.collateral_mint)?;
    let destination_entry = accounts
        .config
        .enabled_destination_entry(&accounts.position.destination_mint)?;
    require_keys_eq!(
        accounts.destination_token_program.key(),
        destination_entry.token_program,
        AccrueError::UnknownTokenProgram
    );

    require!(collateral_amount > 0, AccrueError::PositionSizeOutOfRange);
    require!(borrow_amount > 0, AccrueError::PositionSizeOutOfRange);
    require!(
        leave_usdc_for_later_swap || minimum_destination_amount > 0,
        AccrueError::PositionSizeOutOfRange
    );

    let collateral_reserve = read_reserve_account(&accounts.collateral_reserve)?;
    require_collateral_reserve_of_position(&accounts.position, &collateral_reserve)?;
    require_keys_eq!(
        accounts.collateral_reserve.key(),
        collateral_entry.reserve,
        AccrueError::CollateralNotAllowed
    );
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
    require!(
        collateral_reserve.is_active(),
        AccrueError::CollateralNotAllowed
    );

    let borrow_reserve = read_reserve_account(&accounts.borrow_reserve)?;
    require_the_borrow_reserve_the_position_recorded(
        &accounts.position,
        &accounts.borrow_reserve.key(),
    )?;
    require_the_vaults_the_borrow_reserve_names(
        &borrow_reserve,
        &accounts.borrow_reserve_liquidity_supply.key(),
        Some(&accounts.borrow_reserve_fee_receiver.key()),
    )?;
    require_keys_eq!(
        accounts.borrow_scope_prices.key(),
        borrow_reserve.scope_price_account()?,
        AccrueError::CollateralNotAllowed
    );
    require_keys_eq!(
        accounts.borrow_token_program.key(),
        borrow_reserve.liquidity_token_program,
        AccrueError::UnknownTokenProgram
    );
    require!(
        borrow_reserve.is_active(),
        AccrueError::CollateralNotAllowed
    );

    require_borrow_within_available_share(
        borrow_amount,
        borrow_reserve.liquidity_available_amount,
        accounts.config.max_share_of_available_bps,
    )?;

    Ok(TopUpPlan {
        collateral_farm: collateral_reserve.farm_collateral,
        borrow_farm: borrow_reserve.farm_debt,
    })
}

#[inline(never)]
fn refresh_everything(accounts: &TopUp<'_>) -> Result<()> {
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
    )
}

// The size limit is on the whole position, not on what this call adds to it.
#[inline(never)]
fn require_the_whole_position_is_within_its_size_limit(accounts: &TopUp<'_>) -> Result<()> {
    let deposited_value_scaled =
        read_obligation_deposited_value_scaled(&accounts.obligation.to_account_info())?;
    require!(
        scaled_fraction_to_whole_units(deposited_value_scaled)
            <= u128::from(accounts.config.max_position_usd),
        AccrueError::PositionSizeOutOfRange
    );
    Ok(())
}

// After the borrow the whole position, not just the new part, is at or below its own target.
#[inline(never)]
fn require_the_borrow_landed_at_or_under_target(accounts: &TopUp<'_>) -> Result<()> {
    refresh_everything(accounts)?;
    let obligation = accounts.obligation.to_account_info();
    let adjusted_debt_scaled = read_obligation_adjusted_debt_value_scaled(&obligation)?;
    let deposited_value_scaled = read_obligation_deposited_value_scaled(&obligation)?;

    let allowed_scaled = deposited_value_scaled
        .checked_mul(u128::from(accounts.position.strategy.target_ltv_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;

    require!(
        adjusted_debt_scaled <= allowed_scaled,
        AccrueError::LoanToValueAboveTarget
    );
    Ok(())
}

fn optional_account_info<'info>(
    account: &Option<UncheckedAccount<'info>>,
) -> Option<AccountInfo<'info>> {
    account.as_ref().map(|account| account.to_account_info())
}
