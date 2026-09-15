use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::error::AccrueError;
use crate::state::Config;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn handle_set_paused(
    context: Context<SetPaused>,
    open_paused: Option<bool>,
    grow_paused: Option<bool>,
) -> Result<()> {
    let authority = context.accounts.authority.key();
    let config = &mut context.accounts.config;

    require!(
        authority == config.admin || authority == config.guardian,
        AccrueError::NotTheGuardianOrAdmin
    );

    if let Some(paused) = open_paused {
        config.open_paused = paused;
    }
    if let Some(paused) = grow_paused {
        config.grow_paused = paused;
    }

    Ok(())
}
