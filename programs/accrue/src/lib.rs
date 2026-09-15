use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod invariants;
pub mod kamino;
pub mod state;

pub(crate) use kamino::generated::KAMINO_LENDING_ID;

use instructions::*;
use state::ConfigLimits;

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
}
