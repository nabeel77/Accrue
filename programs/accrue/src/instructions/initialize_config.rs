use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::state::{Config, ConfigLimits};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub deployer: Signer<'info>,

    #[account(
        init,
        payer = deployer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: stored as the address fees are sent to; never read or written here
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(
    context: Context<InitializeConfig>,
    admin: Pubkey,
    guardian: Pubkey,
    borrow_mint: Pubkey,
    borrow_reserve: Pubkey,
    limits: ConfigLimits,
) -> Result<()> {
    limits.validate()?;

    let config = &mut context.accounts.config;
    config.admin = admin;
    config.guardian = guardian;
    config.treasury = context.accounts.treasury.key();
    config.set_borrow_side(borrow_mint, borrow_reserve)?;
    config.allowed_collateral = Vec::new();
    config.allowed_destinations = Vec::new();
    config.open_paused = false;
    config.grow_paused = false;
    config.sunset = false;
    config.version = 1;
    config.bump = context.bumps.config;
    config.apply_limits(&limits)?;

    Ok(())
}
