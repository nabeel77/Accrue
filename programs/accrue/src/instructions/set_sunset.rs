use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::error::AccrueError;
use crate::state::Config;

#[derive(Accounts)]
pub struct SetSunset<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ AccrueError::NotTheAdmin,
    )]
    pub config: Account<'info, Config>,
}

pub fn handle_set_sunset(context: Context<SetSunset>) -> Result<()> {
    context.accounts.config.sunset = true;
    context.accounts.config.open_paused = true;
    Ok(())
}
