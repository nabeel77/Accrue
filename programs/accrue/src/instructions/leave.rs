use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    CONFIG_SEED, INSTRUCTIONS_SYSVAR_ID, JUPITER_V6_PROGRAM_ID, KAMINO_FARMS_PROGRAM_ID,
    KAMINO_LEND_PROGRAM_ID, POSITION_SEED, TOKEN_PROGRAM_ID,
};
use crate::error::AccrueError;
use crate::instructions::checks::{
    require_borrow_reserve_of_position, require_collateral_reserve_of_position,
};
use crate::invariants::{
    assert_invariants_hold, read_position_ledger, token_account_amount, CollateralMovement,
    InvariantCheck, PositionAccounts, SwapCheck,
};
use crate::kamino::cpi::{
    farm_accounts_for_reserve, refresh_obligation, refresh_reserve, repay_liquidity,
    withdraw_collateral, ObligationContext, RepayAccounts, ReserveRefresh, WithdrawAccounts,
};
use crate::kamino::{
    read_obligation_borrowed_amount_scaled, read_obligation_deposited_amount,
    read_obligation_has_debt, read_reserve_account, scaled_fraction_to_whole_units_rounding_up,
};
use crate::scope::{
    minimum_output_the_oracle_allows, read_scope_price, require_price_is_fresh, SwapSide,
};
use crate::state::{Config, Position, PositionSigner, PositionState};
use crate::swap::{execute_jupiter_swap, JupiterSwap};

#[derive(Accounts)]
pub struct Leave<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

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

    #[account(address = position.collateral_mint @ AccrueError::CollateralNotAllowed)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = position.destination_mint @ AccrueError::DestinationNotAllowed)]
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

    /// CHECK: the wallet the position belongs to, the only address this instruction pays
    #[account(address = position.owner @ AccrueError::NotThePositionOwner)]
    pub owner: UncheckedAccount<'info>,

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
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_collateral_supply: UncheckedAccount<'info>,
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_collateral_mint: UncheckedAccount<'info>,
    /// CHECK: read from the collateral reserve and passed to the lending market unchanged
    #[account(mut)]
    pub collateral_reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: checked against the borrow mint and the position's market before it is used
    #[account(mut, owner = KAMINO_LEND_PROGRAM_ID)]
    pub borrow_reserve: UncheckedAccount<'info>,
    /// CHECK: read from the borrow reserve and passed to the lending market unchanged
    #[account(mut)]
    pub borrow_reserve_liquidity_supply: UncheckedAccount<'info>,

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
    /// CHECK: the lending market mints its collateral tokens under the classic token program
    #[account(address = TOKEN_PROGRAM_ID)]
    pub kamino_collateral_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the collateral mint belongs to, read from the reserve
    pub collateral_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the borrow mint belongs to, read from the reserve
    pub borrow_token_program: UncheckedAccount<'info>,
    /// CHECK: the token program the destination mint belongs to
    pub destination_token_program: UncheckedAccount<'info>,
}

pub fn handle_leave<'info>(
    context: Context<'info, Leave<'info>>,
    jupiter_route_data: Vec<u8>,
) -> Result<()> {
    let accounts = &context.accounts;
    accounts.position.require_not_closed()?;

    let collateral_reserve = read_reserve_account(&accounts.collateral_reserve)?;
    require_collateral_reserve_of_position(&accounts.position, &collateral_reserve)?;
    require_keys_eq!(
        accounts.collateral_token_program.key(),
        collateral_reserve.liquidity_token_program,
        AccrueError::UnknownTokenProgram
    );
    require_keys_eq!(
        accounts.collateral_scope_prices.key(),
        collateral_reserve.scope_price_account()?,
        AccrueError::CollateralNotAllowed
    );

    if !accounts.config.sunset {
        require!(
            accounts.position.strategy.exit_on_flag_enabled,
            AccrueError::ExitOnFlagNotEnabled
        );
        require!(
            collateral_reserve.is_flagged_for_exit(),
            AccrueError::NoReasonToLeave
        );
    }

    let borrow_reserve = read_reserve_account(&accounts.borrow_reserve)?;
    require_borrow_reserve_of_position(
        &accounts.position,
        &borrow_reserve,
        &accounts.borrow_mint.key(),
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

    let collateral_reserve_key = accounts.collateral_reserve.key();
    let borrow_reserve_key = accounts.borrow_reserve.key();
    let position_accounts = PositionAccounts {
        position: accounts.position.to_account_info(),
        collateral_token_account: accounts.position_collateral_account.to_account_info(),
        usdc_token_account: accounts.position_usdc_account.to_account_info(),
        destination_token_account: accounts.position_destination_account.to_account_info(),
        obligation: accounts.obligation.to_account_info(),
    };
    let ledger_before = read_position_ledger(&position_accounts, &collateral_reserve_key)?;

    let signer = PositionSigner::for_position(&accounts.position);
    let position_seeds = signer.seeds();
    let both_reserves = [
        accounts.collateral_reserve.to_account_info(),
        accounts.borrow_reserve.to_account_info(),
    ];

    let clock = Clock::get()?;
    let caller_is_the_owner = accounts.caller.key() == accounts.position.owner;
    let destination_held =
        token_account_amount(&accounts.position_destination_account.to_account_info())?;
    let swap = if destination_held == 0 {
        SwapCheck::NoSwapInThisInstruction
    } else {
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

        let minimum_usdc_out = minimum_output_the_oracle_allows(
            &SwapSide {
                raw_amount: destination_held,
                decimals: accounts.destination_mint.decimals,
                price_scaled: destination_price.usd_per_whole_token_scaled()?,
            },
            accounts.borrow_mint.decimals,
            usdc_price.usd_per_whole_token_scaled()?,
            accounts.config.max_slippage_bps,
        )?;

        execute_jupiter_swap(
            &JupiterSwap {
                source: accounts.position_destination_account.to_account_info(),
                destination: accounts.position_usdc_account.to_account_info(),
                swap_program: accounts.swap_program.to_account_info(),
                amount_in: destination_held,
                minimum_out: minimum_usdc_out,
            },
            &position_accounts,
            context.remaining_accounts,
            &jupiter_route_data,
            &position_seeds,
        )?;
        SwapCheck::BoundsCheckedAroundTheCall
    };

    refresh_the_market(accounts, &both_reserves)?;

    let obligation = accounts.obligation.to_account_info();
    let debt = u64::try_from(scaled_fraction_to_whole_units_rounding_up(
        read_obligation_borrowed_amount_scaled(&obligation, &borrow_reserve_key)?,
    ))
    .map_err(|_| AccrueError::MathOverflow)?;
    let usdc_held = token_account_amount(&accounts.position_usdc_account.to_account_info())?;
    let repaying = debt.min(usdc_held);
    if repaying > 0 {
        let farms = farm_accounts_for_reserve(
            borrow_reserve.farm_debt,
            optional_account_info(&accounts.borrow_reserve_farm_state),
            optional_account_info(&accounts.borrow_obligation_farm_state),
            accounts.farms_program.to_account_info(),
        )?;
        repay_liquidity(
            &obligation_context(accounts),
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
    }

    refresh_the_market(accounts, &both_reserves)?;
    require!(
        !read_obligation_has_debt(&obligation)?,
        AccrueError::DebtStillOutstanding
    );

    let collateral_to_withdraw =
        read_obligation_deposited_amount(&obligation, &collateral_reserve_key)?;
    if collateral_to_withdraw > 0 {
        let farms = farm_accounts_for_reserve(
            collateral_reserve.farm_collateral,
            optional_account_info(&accounts.collateral_reserve_farm_state),
            optional_account_info(&accounts.collateral_obligation_farm_state),
            accounts.farms_program.to_account_info(),
        )?;
        withdraw_collateral(
            &obligation_context(accounts),
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
            &farms,
            collateral_to_withdraw,
            &position_seeds,
        )?;
    }

    send_everything_to_the_owner(accounts, &position_seeds)?;

    assert_invariants_hold(&InvariantCheck {
        accounts: &position_accounts,
        collateral_reserve: &collateral_reserve_key,
        before: &ledger_before,
        collateral_movement: CollateralMovement::ExactlyOut(collateral_to_withdraw),
        swap,
    })?;

    let position = &mut context.accounts.position;
    position.record_repay(repaying)?;
    position.state = PositionState::Closed;
    Ok(())
}

fn optional_account_info<'info>(
    account: &Option<UncheckedAccount<'info>>,
) -> Option<AccountInfo<'info>> {
    account.as_ref().map(|account| account.to_account_info())
}

fn obligation_context<'info>(accounts: &Leave<'info>) -> ObligationContext<'info> {
    ObligationContext {
        obligation: accounts.obligation.to_account_info(),
        lending_market: accounts.lending_market.to_account_info(),
        lending_market_authority: accounts.lending_market_authority.to_account_info(),
        position: accounts.position.to_account_info(),
        kamino_program: accounts.kamino_program.to_account_info(),
    }
}

fn refresh_the_market<'info>(
    accounts: &Leave<'info>,
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

fn send_everything_to_the_owner(accounts: &Leave<'_>, position_seeds: &[&[u8]]) -> Result<()> {
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
