use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    BASIS_POINTS_DENOMINATOR, CONFIG_SEED, INSTRUCTIONS_SYSVAR_ID, KAMINO_LEND_PROGRAM_ID,
    POSITION_SEED, TOKEN_PROGRAM_ID,
};
use crate::error::AccrueError;
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, CollateralMovement, PositionAccounts,
};
use crate::kamino::cpi::{
    borrow_liquidity, deposit_collateral, init_obligation, init_user_metadata, refresh_obligation,
    refresh_reserve, BorrowAccounts, DepositAccounts, InitObligationAccounts,
    InitUserMetadataAccounts, ObligationContext, ReserveRefresh,
};
use crate::kamino::{read_reserve_account, scaled_fraction_to_whole_units, SCALED_FRACTION_ONE};
use crate::state::{Config, Position, PositionState, Strategy};
use crate::swap::{execute_jupiter_swap, JupiterSwap};

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [
            POSITION_SEED,
            owner.key().as_ref(),
            collateral_mint.key().as_ref(),
            destination_mint.key().as_ref(),
        ],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,

    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub destination_mint: Box<InterfaceAccount<'info, Mint>>,
    pub borrow_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = owner,
        associated_token::token_program = collateral_token_program,
    )]
    pub owner_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = position,
        associated_token::token_program = collateral_token_program,
    )]
    pub position_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = borrow_mint,
        associated_token::authority = position,
        associated_token::token_program = borrow_token_program,
    )]
    pub position_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = destination_mint,
        associated_token::authority = position,
        associated_token::token_program = destination_token_program,
    )]
    pub position_destination_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: owned by the lending market program and decoded at its published layout
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub lending_market: UncheckedAccount<'info>,

    /// CHECK: the market's own signing authority, derived and checked by the lending market
    pub lending_market_authority: UncheckedAccount<'info>,

    /// CHECK: created by the lending market during this instruction at a seed it derives
    #[account(mut)]
    pub obligation: UncheckedAccount<'info>,

    /// CHECK: created by the lending market during this instruction at a seed it derives
    #[account(mut)]
    pub user_metadata: UncheckedAccount<'info>,

    /// CHECK: matched against the reserve recorded for this collateral in the config
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

    /// CHECK: the USDC reserve on the same market, checked against the borrow mint
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub borrow_reserve: UncheckedAccount<'info>,

    /// CHECK: read from the borrow reserve and passed to the lending market unchanged
    #[account(mut)]
    pub borrow_reserve_liquidity_supply: UncheckedAccount<'info>,

    /// CHECK: read from the borrow reserve and passed to the lending market unchanged
    #[account(mut)]
    pub borrow_reserve_fee_receiver: UncheckedAccount<'info>,

    /// CHECK: matched against the price account the collateral entry records in the config
    pub scope_prices: UncheckedAccount<'info>,

    /// CHECK: the lending market program itself, checked against the constants module
    #[account(address = KAMINO_LEND_PROGRAM_ID)]
    pub kamino_program: UncheckedAccount<'info>,

    /// CHECK: read by the lending market to see the other instructions in this transaction
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,

    /// CHECK: the token program the collateral mint belongs to, checked against the config
    pub collateral_token_program: UncheckedAccount<'info>,
    /// CHECK: the lending market mints its collateral tokens under the classic token program
    #[account(address = TOKEN_PROGRAM_ID)]
    pub kamino_collateral_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program USDC belongs to
    pub borrow_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the destination mint belongs to, checked against the config
    pub destination_token_program: UncheckedAccount<'info>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_position<'info>(
    context: Context<'info, OpenPosition<'info>>,
    collateral_amount: u64,
    borrow_amount: u64,
    minimum_destination_amount: u64,
    strategy: Strategy,
    leave_usdc_for_later_swap: bool,
    jupiter_route_data: Vec<u8>,
) -> Result<()> {
    let accounts = &context.accounts;
    accounts.config.require_opens_allowed()?;

    let collateral_entry = accounts
        .config
        .enabled_collateral_entry(&accounts.collateral_mint.key())?;
    let destination_entry = accounts
        .config
        .enabled_destination_entry(&accounts.destination_mint.key())?;

    require_keys_eq!(
        accounts.collateral_reserve.key(),
        collateral_entry.reserve,
        AccrueError::CollateralNotAllowed
    );
    require_keys_eq!(
        accounts.scope_prices.key(),
        collateral_entry.scope_price_account,
        AccrueError::CollateralNotAllowed
    );
    require_keys_eq!(
        accounts.collateral_token_program.key(),
        collateral_entry.token_program,
        AccrueError::UnknownTokenProgram
    );
    require_keys_eq!(
        accounts.destination_token_program.key(),
        destination_entry.token_program,
        AccrueError::UnknownTokenProgram
    );

    let collateral_reserve = read_reserve_account(&accounts.collateral_reserve)?;
    let borrow_reserve = read_reserve_account(&accounts.borrow_reserve)?;

    require_keys_eq!(
        collateral_reserve.lending_market,
        accounts.lending_market.key(),
        AccrueError::CollateralNotAllowed
    );
    require_keys_eq!(
        borrow_reserve.lending_market,
        accounts.lending_market.key(),
        AccrueError::CollateralNotAllowed
    );
    require_keys_eq!(
        collateral_reserve.liquidity_mint,
        accounts.collateral_mint.key(),
        AccrueError::CollateralNotAllowed
    );
    require_keys_eq!(
        borrow_reserve.liquidity_mint,
        accounts.borrow_mint.key(),
        AccrueError::CollateralNotAllowed
    );
    require!(
        collateral_reserve.is_active(),
        AccrueError::CollateralNotAllowed
    );
    require!(
        borrow_reserve.is_active(),
        AccrueError::CollateralNotAllowed
    );

    strategy.validate_against_reserve(
        collateral_reserve.max_loan_to_value_bps()?,
        collateral_reserve.liquidation_threshold_bps()?,
    )?;

    require!(collateral_amount > 0, AccrueError::PositionSizeOutOfRange);
    require!(borrow_amount > 0, AccrueError::PositionSizeOutOfRange);

    let collateral_value_usd = collateral_value_in_whole_usd(
        collateral_amount,
        collateral_reserve.liquidity_market_price_scaled,
        collateral_reserve.liquidity_mint_decimals,
    )?;
    require!(
        collateral_value_usd >= u128::from(accounts.config.min_position_usd)
            && collateral_value_usd <= u128::from(accounts.config.max_position_usd),
        AccrueError::PositionSizeOutOfRange
    );

    require_borrow_within_target(
        borrow_amount,
        borrow_reserve.liquidity_mint_decimals,
        borrow_reserve.liquidity_market_price_scaled,
        collateral_value_usd,
        strategy.target_ltv_bps,
    )?;

    require_borrow_within_available_share(
        borrow_amount,
        borrow_reserve.liquidity_available_amount,
        accounts.config.max_share_of_available_bps,
    )?;

    let owner_key = accounts.owner.key();
    let collateral_mint_key = accounts.collateral_mint.key();
    let destination_mint_key = accounts.destination_mint.key();
    let position_bump = [context.bumps.position];
    let position_seeds: [&[u8]; 5] = [
        POSITION_SEED,
        owner_key.as_ref(),
        collateral_mint_key.as_ref(),
        destination_mint_key.as_ref(),
        &position_bump,
    ];

    init_user_metadata(
        &InitUserMetadataAccounts {
            user_metadata: accounts.user_metadata.to_account_info(),
            fee_payer: accounts.owner.to_account_info(),
            position: accounts.position.to_account_info(),
            rent: accounts.rent.to_account_info(),
            system_program: accounts.system_program.to_account_info(),
        },
        &position_seeds,
    )?;

    init_obligation(
        &InitObligationAccounts {
            obligation: accounts.obligation.to_account_info(),
            lending_market: accounts.lending_market.to_account_info(),
            seed1_account: accounts.system_program.to_account_info(),
            seed2_account: accounts.system_program.to_account_info(),
            owner_user_metadata: accounts.user_metadata.to_account_info(),
            fee_payer: accounts.owner.to_account_info(),
            position: accounts.position.to_account_info(),
            rent: accounts.rent.to_account_info(),
            system_program: accounts.system_program.to_account_info(),
        },
        &position_seeds,
    )?;

    transfer_collateral_from_owner(context.accounts, collateral_amount)?;

    let position_accounts = PositionAccounts {
        position: accounts.position.to_account_info(),
        collateral_token_account: accounts.position_collateral_account.to_account_info(),
        usdc_token_account: accounts.position_usdc_account.to_account_info(),
        destination_token_account: accounts.position_destination_account.to_account_info(),
        obligation: accounts.obligation.to_account_info(),
    };
    let ledger_before = read_position_ledger(&position_accounts, &collateral_entry.reserve)?;

    refresh_both_reserves(accounts)?;
    refresh_obligation(
        &accounts.obligation.to_account_info(),
        &accounts.lending_market.to_account_info(),
        &[],
    )?;

    let kamino_collateral_token_program =
        accounts.kamino_collateral_token_program.to_account_info();
    let kamino_liquidity_token_program = accounts.collateral_token_program.to_account_info();

    let obligation_context = ObligationContext {
        obligation: accounts.obligation.to_account_info(),
        lending_market: accounts.lending_market.to_account_info(),
        lending_market_authority: accounts.lending_market_authority.to_account_info(),
        position: accounts.position.to_account_info(),
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
            collateral_token_program: kamino_collateral_token_program.clone(),
            liquidity_token_program: kamino_liquidity_token_program.clone(),
            instruction_sysvar: accounts.instruction_sysvar.to_account_info(),
        },
        collateral_amount,
        &position_seeds,
    )?;

    refresh_both_reserves(accounts)?;
    refresh_obligation(
        &accounts.obligation.to_account_info(),
        &accounts.lending_market.to_account_info(),
        &[
            accounts.collateral_reserve.to_account_info(),
            accounts.borrow_reserve.to_account_info(),
        ],
    )?;

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
        borrow_amount,
        &position_seeds,
    )?;

    let deposited_collateral = deposited_collateral_after(
        &accounts.obligation.to_account_info(),
        &collateral_entry.reserve,
    )?;
    let collateral_movement = CollateralMovement::ExactlyIn(
        deposited_collateral
            .checked_sub(ledger_before.obligation_collateral)
            .ok_or(AccrueError::ObligationCollateralMoved)?,
    );

    let swapped = if leave_usdc_for_later_swap {
        None
    } else {
        Some(execute_jupiter_swap(
            &JupiterSwap {
                source: accounts.position_usdc_account.to_account_info(),
                destination: accounts.position_destination_account.to_account_info(),
                amount_in: borrow_amount,
                minimum_out: minimum_destination_amount,
            },
            &position_accounts,
            context.remaining_accounts,
            &jupiter_route_data,
            &position_seeds,
        )?)
    };

    assert_invariants_hold(
        &position_accounts,
        &collateral_entry.reserve,
        &ledger_before,
        collateral_movement,
        swapped,
        Some(&accounts.position_usdc_account.key()),
        Some(&accounts.position_destination_account.key()),
    )?;

    let clock = Clock::get()?;
    let position = &mut context.accounts.position;
    position.owner = owner_key;
    position.collateral_mint = collateral_mint_key;
    position.destination_mint = destination_mint_key;
    position.market = context.accounts.lending_market.key();
    position.obligation = context.accounts.obligation.key();
    position.collateral_token_account = context.accounts.position_collateral_account.key();
    position.usdc_token_account = context.accounts.position_usdc_account.key();
    position.destination_token_account = context.accounts.position_destination_account.key();
    position.strategy = strategy;
    position.fee_bps_at_open = context.accounts.config.performance_fee_bps;
    position.state = if leave_usdc_for_later_swap {
        PositionState::AwaitingSwap
    } else {
        PositionState::Open
    };
    position.opened_at = clock.unix_timestamp;
    position.last_protect_at = 0;
    position.last_grow_at = 0;
    position.protect_count = 0;
    position.grow_count = 0;
    position.usdc_borrowed_total = 0;
    position.usdc_repaid_total = 0;
    position.bump = context.bumps.position;
    position.record_borrow(borrow_amount)?;

    Ok(())
}

fn refresh_both_reserves(accounts: &OpenPosition<'_>) -> Result<()> {
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
            scope_prices: accounts.scope_prices.to_account_info(),
        },
        &accounts.kamino_program.to_account_info(),
    )
}

fn transfer_collateral_from_owner(accounts: &OpenPosition<'_>, amount: u64) -> Result<()> {
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
        amount,
        accounts.collateral_mint.decimals,
    )
}

fn deposited_collateral_after(obligation: &AccountInfo<'_>, reserve: &Pubkey) -> Result<u64> {
    let snapshot = crate::kamino::read_obligation_account(obligation)?;
    Ok(snapshot.deposited_amount_for_reserve(reserve))
}

fn collateral_value_in_whole_usd(
    raw_amount: u64,
    market_price_scaled: u128,
    decimals: u8,
) -> Result<u128> {
    let price_whole = scaled_fraction_to_whole_units(
        market_price_scaled
            .checked_mul(SCALED_FRACTION_ONE)
            .ok_or(AccrueError::MathOverflow)?,
    );
    let value_scaled = u128::from(raw_amount)
        .checked_mul(price_whole)
        .ok_or(AccrueError::MathOverflow)?;
    let divisor = ten_to_the(decimals)?
        .checked_mul(SCALED_FRACTION_ONE)
        .ok_or(AccrueError::MathOverflow)?;
    Ok(value_scaled
        .checked_div(divisor)
        .ok_or(AccrueError::MathOverflow)?)
}

fn require_borrow_within_target(
    borrow_amount: u64,
    borrow_decimals: u8,
    borrow_price_scaled: u128,
    collateral_value_usd: u128,
    target_ltv_bps: u16,
) -> Result<()> {
    let borrow_value_usd =
        collateral_value_in_whole_usd(borrow_amount, borrow_price_scaled, borrow_decimals)?;
    let allowed = collateral_value_usd
        .checked_mul(u128::from(target_ltv_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;
    require!(
        borrow_value_usd <= allowed,
        AccrueError::LoanToValueAboveTarget
    );
    Ok(())
}

fn require_borrow_within_available_share(
    borrow_amount: u64,
    available_amount: u64,
    max_share_bps: u16,
) -> Result<()> {
    let ceiling = u128::from(available_amount)
        .checked_mul(u128::from(max_share_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;
    require!(
        u128::from(borrow_amount) <= ceiling,
        AccrueError::BorrowTooLargeAShareOfLiquidity
    );
    Ok(())
}

fn ten_to_the(decimals: u8) -> Result<u128> {
    10u128
        .checked_pow(u32::from(decimals))
        .ok_or_else(|| AccrueError::MathOverflow.into())
}
