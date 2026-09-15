use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::error::AccrueError;
use crate::state::{CollateralEntry, Config, ConfigLimits, DestinationEntry};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ AccrueError::NotTheAdmin,
    )]
    pub config: Account<'info, Config>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct ConfigUpdate {
    pub limits: Option<ConfigLimits>,
    pub treasury: Option<Pubkey>,
    pub guardian: Option<Pubkey>,
    pub admin: Option<Pubkey>,
    pub collateral: Option<CollateralEntry>,
    pub destination: Option<DestinationEntry>,
}

pub fn handle_update_config(context: Context<UpdateConfig>, update: ConfigUpdate) -> Result<()> {
    let config = &mut context.accounts.config;

    if let Some(limits) = update.limits {
        config.apply_limits(&limits)?;
    }
    if let Some(treasury) = update.treasury {
        require_keys_neq!(treasury, Pubkey::default(), AccrueError::WrongTreasury);
        config.treasury = treasury;
    }
    if let Some(guardian) = update.guardian {
        config.guardian = guardian;
    }
    if let Some(admin) = update.admin {
        require_keys_neq!(admin, Pubkey::default(), AccrueError::NotTheAdmin);
        config.admin = admin;
    }
    if let Some(entry) = update.collateral {
        config.upsert_collateral(entry)?;
    }
    if let Some(entry) = update.destination {
        config.upsert_destination(entry)?;
    }

    config.version = config
        .version
        .checked_add(1)
        .ok_or(AccrueError::MathOverflow)?;

    Ok(())
}
