use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    CONFIG_SEED, INSTRUCTIONS_SYSVAR_ID, JUPITER_V6_PROGRAM_ID, KAMINO_FARMS_PROGRAM_ID,
    KAMINO_LEND_PROGRAM_ID, POSITION_SEED,
};
use crate::error::AccrueError;
use crate::guard::{protect_amounts, require_the_interval_has_elapsed};
use crate::instructions::checks::{
    require_borrow_reserve_of_position, require_collateral_reserve_of_position,
    require_the_vaults_the_borrow_reserve_names,
};
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, token_account_amount, CollateralMovement,
    InvariantCheck, PositionAccounts, SwapCheck,
};
use crate::kamino::cpi::{
    farm_accounts_for_reserve, refresh_obligation, refresh_reserve, repay_liquidity,
    ObligationContext, RepayAccounts, ReserveRefresh,
};
use crate::kamino::{
    read_obligation_adjusted_debt_value_scaled, read_obligation_borrowed_amount_scaled,
    read_obligation_deposited_value_scaled, read_obligation_loan_to_value_bps,
    read_reserve_account, scaled_fraction_to_whole_units_rounding_up,
};
use crate::scope::{
    add_the_slippage_buffer, minimum_output_the_oracle_allows, raw_amount_worth_rounding_down,
    raw_amount_worth_rounding_up, read_scope_price, require_price_is_fresh, usd_value_of_scaled,
    SwapSide,
};
use crate::state::{Config, Position, PositionSigner, PositionState};
use crate::swap::{execute_jupiter_swap, JupiterSwap};

#[derive(Accounts)]
pub struct Protect<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        token::mint = borrow_mint,
        token::authority = caller,
    )]
    pub caller_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [
            POSITION_SEED,
            position.owner.as_ref(),
            position.collateral_mint.as_ref(),
            position.destination_mint.as_ref(),
        ],
        bump = position.bump,
        has_one = obligation @ AccrueError::WrongPositionState,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(address = position.destination_mint @ AccrueError::DestinationNotAllowed)]
    pub destination_mint: Box<InterfaceAccount<'info, Mint>>,
    pub borrow_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = position.collateral_token_account @ AccrueError::WrongPositionState)]
    pub position_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = position.usdc_token_account @ AccrueError::WrongPositionState)]
    pub position_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = position.destination_token_account @ AccrueError::WrongPositionState)]
    pub position_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: matched against the obligation recorded on the position
    #[account(mut)]
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
    /// CHECK: matched against the price account the destination entry records in the config
    pub destination_scope_prices: UncheckedAccount<'info>,

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
    /// CHECK: the token program the borrow mint belongs to, read from the reserve
    pub borrow_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the destination mint belongs to
    pub destination_token_program: UncheckedAccount<'info>,
}

pub fn handle_protect<'info>(
    context: Context<'info, Protect<'info>>,
    owner_minimum_usdc_out: u64,
    jupiter_route_data: Vec<u8>,
) -> Result<()> {
    let accounts = &context.accounts;
    accounts.position.require_state(PositionState::Open)?;

    let collateral_reserve = read_reserve_account(&accounts.collateral_reserve)?;
    require_collateral_reserve_of_position(&accounts.position, &collateral_reserve)?;
    require_keys_eq!(
        accounts.collateral_scope_prices.key(),
        collateral_reserve.scope_price_account()?,
        AccrueError::CollateralNotAllowed
    );

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

    let destination_entry = accounts
        .config
        .destination_entry(&accounts.position.destination_mint)
        .copied()
        .ok_or(AccrueError::DestinationNotAllowed)?;
    require_keys_eq!(
        accounts.destination_scope_prices.key(),
        destination_entry.scope_price_account,
        AccrueError::DestinationNotAllowed
    );
    require_keys_eq!(
        accounts.destination_token_program.key(),
        destination_entry.token_program,
        AccrueError::UnknownTokenProgram
    );

    let both_reserves = [
        accounts.collateral_reserve.to_account_info(),
        accounts.borrow_reserve.to_account_info(),
    ];
    refresh_the_market(accounts, &both_reserves)?;

    let obligation = accounts.obligation.to_account_info();
    let loan_to_value_bps = read_obligation_loan_to_value_bps(&obligation)?;
    require!(
        loan_to_value_bps >= accounts.position.strategy.protect_ltv_bps,
        AccrueError::GuardLevelNotReached
    );

    let clock = Clock::get()?;
    let caller_is_the_owner = accounts.caller.key() == accounts.position.owner;
    // The interval exists so a keeper cannot repay the same position in a loop for the bounty.
    // Neither reason holds once the market can seize the collateral, and the owner is never
    // farming their own position, so both of those act without waiting.
    let past_the_liquidation_line =
        loan_to_value_bps >= collateral_reserve.liquidation_threshold_bps()?;
    if !caller_is_the_owner && !past_the_liquidation_line {
        require_the_interval_has_elapsed(
            accounts.position.last_protect_at,
            clock.unix_timestamp,
            accounts.config.min_protect_interval_seconds,
        )?;
    }
    let usdc_price = read_scope_price(
        &accounts.borrow_scope_prices,
        borrow_reserve.scope_feed_index()?,
    )?;
    let destination_price = read_scope_price(
        &accounts.destination_scope_prices,
        destination_entry.scope_feed_index,
    )?;
    if !caller_is_the_owner {
        require_price_is_fresh(&usdc_price, clock.slot, accounts.config.max_price_age_slots)?;
        require_price_is_fresh(
            &destination_price,
            clock.slot,
            accounts.config.max_price_age_slots,
        )?;
    }
    let usdc_price_scaled = usdc_price.usd_per_whole_token_scaled()?;
    let destination_price_scaled = destination_price.usd_per_whole_token_scaled()?;

    let amounts = protect_amounts(
        read_obligation_adjusted_debt_value_scaled(&obligation)?,
        read_obligation_deposited_value_scaled(&obligation)?,
        accounts.position.strategy.target_ltv_bps,
        accounts.config.keeper_bounty_bps,
        borrow_reserve.borrow_factor_pct()?,
    )?;

    let usdc_decimals = accounts.borrow_mint.decimals;
    let destination_decimals = accounts.destination_mint.decimals;

    let repay_needed =
        raw_amount_worth_rounding_up(amounts.repay_usd_scaled, usdc_decimals, usdc_price_scaled)?;
    let bounty_wanted = raw_amount_worth_rounding_down(
        amounts.bounty_usd_scaled,
        usdc_decimals,
        usdc_price_scaled,
    )?
    .min(accounts.config.keeper_bounty_cap_usdc);

    let usdc_to_raise = repay_needed
        .checked_add(bounty_wanted)
        .ok_or(AccrueError::MathOverflow)?;
    let destination_at_the_oracle_price = raw_amount_worth_rounding_up(
        usd_value_of_scaled(usdc_to_raise, usdc_decimals, usdc_price_scaled)?,
        destination_decimals,
        destination_price_scaled,
    )?;

    let destination_held =
        token_account_amount(&accounts.position_destination_account.to_account_info())?;
    let destination_to_sell = add_the_slippage_buffer(
        destination_at_the_oracle_price,
        accounts.config.max_slippage_bps,
    )?
    .min(destination_held);
    require!(destination_to_sell > 0, AccrueError::NothingToSell);

    let minimum_usdc_out = if caller_is_the_owner {
        owner_minimum_usdc_out
    } else {
        minimum_output_the_oracle_allows(
            &SwapSide {
                raw_amount: destination_to_sell,
                decimals: destination_decimals,
                price_scaled: destination_price_scaled,
            },
            usdc_decimals,
            usdc_price_scaled,
            accounts.config.max_slippage_bps,
        )?
    };

    let position_accounts = PositionAccounts {
        position: accounts.position.to_account_info(),
        collateral_token_account: accounts.position_collateral_account.to_account_info(),
        usdc_token_account: accounts.position_usdc_account.to_account_info(),
        destination_token_account: accounts.position_destination_account.to_account_info(),
        obligation: accounts.obligation.to_account_info(),
    };
    let collateral_reserve_key = accounts.collateral_reserve.key();
    let ledger_before = read_position_ledger(&position_accounts, &collateral_reserve_key)?;

    let signer = PositionSigner::for_position(&accounts.position);
    let position_seeds = signer.seeds();

    execute_jupiter_swap(
        &JupiterSwap {
            source: accounts.position_destination_account.to_account_info(),
            destination: accounts.position_usdc_account.to_account_info(),
            swap_program: accounts.swap_program.to_account_info(),
            amount_in: destination_to_sell,
            minimum_out: minimum_usdc_out,
        },
        &position_accounts,
        context.remaining_accounts,
        &jupiter_route_data,
        &position_seeds,
    )?;

    let usdc_raised = token_account_amount(&accounts.position_usdc_account.to_account_info())?
        .checked_sub(ledger_before.usdc_balance)
        .ok_or(AccrueError::SwapSpentTooMuch)?;

    let borrow_reserve_key = accounts.borrow_reserve.key();
    let debt_now = u64::try_from(scaled_fraction_to_whole_units_rounding_up(
        read_obligation_borrowed_amount_scaled(&obligation, &borrow_reserve_key)?,
    ))
    .map_err(|_| AccrueError::MathOverflow)?;
    let repaying = repay_needed.min(usdc_raised).min(debt_now);
    require!(repaying > 0, AccrueError::NothingToSell);

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
        repaying,
        &position_seeds,
    )?;

    let bounty = bounty_wanted.min(usdc_raised.saturating_sub(repaying));
    if bounty > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(
                accounts.borrow_token_program.key(),
                anchor_spl::token_interface::TransferChecked {
                    from: accounts.position_usdc_account.to_account_info(),
                    mint: accounts.borrow_mint.to_account_info(),
                    to: accounts.caller_usdc_account.to_account_info(),
                    authority: accounts.position.to_account_info(),
                },
                &[&position_seeds],
            ),
            bounty,
            usdc_decimals,
        )?;
    }

    refresh_the_market(accounts, &both_reserves)?;
    let loan_to_value_after = read_obligation_loan_to_value_bps(&obligation)?;
    let destination_left =
        token_account_amount(&accounts.position_destination_account.to_account_info())?;
    require!(
        loan_to_value_after <= accounts.position.strategy.target_ltv_bps || destination_left == 0,
        AccrueError::LoanToValueAboveTarget
    );

    assert_invariants_hold(&InvariantCheck {
        accounts: &position_accounts,
        collateral_reserve: &collateral_reserve_key,
        before: &ledger_before,
        collateral_movement: CollateralMovement::MustNotMove,
        swap: SwapCheck::BoundsCheckedAroundTheCall,
    })?;

    let position = &mut context.accounts.position;
    position.last_protect_at = clock.unix_timestamp;
    position.protect_count = position
        .protect_count
        .checked_add(1)
        .ok_or(AccrueError::MathOverflow)?;
    position.record_sale(usdc_raised)?;
    position.record_repay(repaying)?;
    Ok(())
}

fn refresh_the_market<'info>(
    accounts: &Protect<'info>,
    both_reserves: &[AccountInfo<'info>],
) -> Result<()> {
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
        both_reserves,
    )
}
