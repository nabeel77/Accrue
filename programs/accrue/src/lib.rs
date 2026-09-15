use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod guard;
pub mod instructions;
pub mod invariants;
pub mod kamino;
pub mod scope;
pub mod state;
pub mod swap;

pub(crate) use kamino::generated::KAMINO_LENDING_ID;

use instructions::*;
use state::{ConfigLimits, Strategy};

declare_id!("6KUwCyECUrvjppwAe92FxTqHLvw2LKGmfkV7j37r6gBb");

#[program]
pub mod accrue {
    use super::*;

    pub fn initialize_config(
        context: Context<InitializeConfig>,
        admin: Pubkey,
        guardian: Pubkey,
        limits: ConfigLimits,
    ) -> Result<()> {
        handle_initialize_config(context, admin, guardian, limits)
    }

    pub fn update_config(context: Context<UpdateConfig>, update: ConfigUpdate) -> Result<()> {
        handle_update_config(context, update)
    }

    pub fn set_paused(
        context: Context<SetPaused>,
        open_paused: Option<bool>,
        grow_paused: Option<bool>,
    ) -> Result<()> {
        handle_set_paused(context, open_paused, grow_paused)
    }

    pub fn set_sunset(context: Context<SetSunset>) -> Result<()> {
        handle_set_sunset(context)
    }

    pub fn open_position<'info>(
        context: Context<'info, OpenPosition<'info>>,
        collateral_amount: u64,
        borrow_amount: u64,
        minimum_destination_amount: u64,
        strategy: Strategy,
        leave_usdc_for_later_swap: bool,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        handle_open_position(
            context,
            collateral_amount,
            borrow_amount,
            minimum_destination_amount,
            strategy,
            leave_usdc_for_later_swap,
            jupiter_route_data,
        )
    }

    pub fn buy_destination<'info>(
        context: Context<'info, BuyDestination<'info>>,
        minimum_destination_amount: u64,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        handle_buy_destination(context, minimum_destination_amount, jupiter_route_data)
    }

    pub fn add_collateral(context: Context<AddCollateral>, collateral_amount: u64) -> Result<()> {
        handle_add_collateral(context, collateral_amount)
    }

    pub fn repay(context: Context<Repay>, requested_amount: u64) -> Result<()> {
        handle_repay(context, requested_amount)
    }

    pub fn withdraw_collateral(
        context: Context<WithdrawCollateral>,
        collateral_token_amount: u64,
    ) -> Result<()> {
        handle_withdraw_collateral(context, collateral_token_amount)
    }

    pub fn set_strategy(context: Context<SetStrategy>, strategy: Strategy) -> Result<()> {
        handle_set_strategy(context, strategy)
    }

    pub fn unwind<'info>(
        context: Context<'info, Unwind<'info>>,
        minimum_usdc_out: u64,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        handle_unwind(context, minimum_usdc_out, jupiter_route_data)
    }

    pub fn rescue(context: Context<Rescue>) -> Result<()> {
        handle_rescue(context)
    }

    pub fn close_position(context: Context<ClosePosition>) -> Result<()> {
        handle_close_position(context)
    }

    pub fn protect<'info>(
        context: Context<'info, Protect<'info>>,
        owner_minimum_usdc_out: u64,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        handle_protect(context, owner_minimum_usdc_out, jupiter_route_data)
    }

    pub fn grow<'info>(
        context: Context<'info, Grow<'info>>,
        owner_minimum_destination_out: u64,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        handle_grow(context, owner_minimum_destination_out, jupiter_route_data)
    }

    pub fn leave<'info>(
        context: Context<'info, Leave<'info>>,
        jupiter_route_data: Vec<u8>,
    ) -> Result<()> {
        handle_leave(context, jupiter_route_data)
    }
}
