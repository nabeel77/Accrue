use anchor_lang::prelude::*;

use crate::constants::{
    is_known_token_program, KEEPER_BOUNTY_BPS_CEILING, MAX_ALLOWED_COLLATERAL,
    MAX_ALLOWED_DESTINATIONS, MAX_PRICE_AGE_SLOTS_CEILING, MIN_GROW_INTERVAL_SECONDS_FLOOR,
    MIN_PROTECT_INTERVAL_SECONDS_FLOOR, PERFORMANCE_FEE_BPS_CEILING,
    SHARE_OF_AVAILABLE_BPS_CEILING, SLIPPAGE_BPS_CEILING,
};
use crate::error::AccrueError;

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct CollateralEntry {
    pub mint: Pubkey,
    pub reserve: Pubkey,
    pub token_program: Pubkey,
    pub scope_price_account: Pubkey,
    pub scope_feed_index: u16,
    pub enabled: bool,
}

impl CollateralEntry {
    pub fn is_usable(&self) -> bool {
        self.enabled && self.mint != Pubkey::default()
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct DestinationEntry {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub scope_price_account: Pubkey,
    pub scope_feed_index: u16,
    pub enabled: bool,
}

impl DestinationEntry {
    pub fn is_usable(&self) -> bool {
        self.enabled && self.mint != Pubkey::default()
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub guardian: Pubkey,
    pub treasury: Pubkey,
    pub borrow_mint: Pubkey,
    pub borrow_reserve: Pubkey,
    pub keeper_bounty_bps: u16,
    pub keeper_bounty_cap_usdc: u64,
    pub performance_fee_bps: u16,
    pub max_slippage_bps: u16,
    pub max_price_age_slots: u64,
    pub min_protect_interval_seconds: u64,
    pub min_grow_interval_seconds: u64,
    pub max_share_of_available_bps: u16,
    pub min_position_usd: u64,
    pub max_position_usd: u64,
    #[max_len(MAX_ALLOWED_COLLATERAL)]
    pub allowed_collateral: Vec<CollateralEntry>,
    #[max_len(MAX_ALLOWED_DESTINATIONS)]
    pub allowed_destinations: Vec<DestinationEntry>,
    pub open_paused: bool,
    pub grow_paused: bool,
    pub sunset: bool,
    pub version: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ConfigLimits {
    pub keeper_bounty_bps: u16,
    pub keeper_bounty_cap_usdc: u64,
    pub performance_fee_bps: u16,
    pub max_slippage_bps: u16,
    pub max_price_age_slots: u64,
    pub min_protect_interval_seconds: u64,
    pub min_grow_interval_seconds: u64,
    pub max_share_of_available_bps: u16,
    pub min_position_usd: u64,
    pub max_position_usd: u64,
}

impl ConfigLimits {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.performance_fee_bps <= PERFORMANCE_FEE_BPS_CEILING,
            AccrueError::PerformanceFeeAboveCeiling
        );
        require!(
            self.max_slippage_bps <= SLIPPAGE_BPS_CEILING,
            AccrueError::SlippageAboveCeiling
        );
        require!(
            self.keeper_bounty_bps <= KEEPER_BOUNTY_BPS_CEILING,
            AccrueError::KeeperBountyAboveCeiling
        );
        require!(
            self.max_share_of_available_bps <= SHARE_OF_AVAILABLE_BPS_CEILING,
            AccrueError::ShareOfAvailableAboveCeiling
        );
        require!(
            self.max_price_age_slots > 0 && self.max_price_age_slots <= MAX_PRICE_AGE_SLOTS_CEILING,
            AccrueError::PriceAgeAboveCeiling
        );
        require!(
            self.min_protect_interval_seconds >= MIN_PROTECT_INTERVAL_SECONDS_FLOOR,
            AccrueError::IntervalBelowFloor
        );
        require!(
            self.min_grow_interval_seconds >= MIN_GROW_INTERVAL_SECONDS_FLOOR,
            AccrueError::IntervalBelowFloor
        );
        require!(
            self.min_position_usd > 0 && self.min_position_usd <= self.max_position_usd,
            AccrueError::PositionSizeLimitsInverted
        );
        Ok(())
    }
}

impl Config {
    pub fn limits(&self) -> ConfigLimits {
        ConfigLimits {
            keeper_bounty_bps: self.keeper_bounty_bps,
            keeper_bounty_cap_usdc: self.keeper_bounty_cap_usdc,
            performance_fee_bps: self.performance_fee_bps,
            max_slippage_bps: self.max_slippage_bps,
            max_price_age_slots: self.max_price_age_slots,
            min_protect_interval_seconds: self.min_protect_interval_seconds,
            min_grow_interval_seconds: self.min_grow_interval_seconds,
            max_share_of_available_bps: self.max_share_of_available_bps,
            min_position_usd: self.min_position_usd,
            max_position_usd: self.max_position_usd,
        }
    }

    pub fn apply_limits(&mut self, limits: &ConfigLimits) -> Result<()> {
        limits.validate()?;
        self.keeper_bounty_bps = limits.keeper_bounty_bps;
        self.keeper_bounty_cap_usdc = limits.keeper_bounty_cap_usdc;
        self.performance_fee_bps = limits.performance_fee_bps;
        self.max_slippage_bps = limits.max_slippage_bps;
        self.max_price_age_slots = limits.max_price_age_slots;
        self.min_protect_interval_seconds = limits.min_protect_interval_seconds;
        self.min_grow_interval_seconds = limits.min_grow_interval_seconds;
        self.max_share_of_available_bps = limits.max_share_of_available_bps;
        self.min_position_usd = limits.min_position_usd;
        self.max_position_usd = limits.max_position_usd;
        Ok(())
    }

    pub fn collateral_entry(&self, mint: &Pubkey) -> Option<&CollateralEntry> {
        self.allowed_collateral
            .iter()
            .find(|entry| entry.mint == *mint)
    }

    pub fn destination_entry(&self, mint: &Pubkey) -> Option<&DestinationEntry> {
        self.allowed_destinations
            .iter()
            .find(|entry| entry.mint == *mint)
    }

    pub fn enabled_collateral_entry(&self, mint: &Pubkey) -> Result<CollateralEntry> {
        let entry = self
            .collateral_entry(mint)
            .ok_or(AccrueError::CollateralNotAllowed)?;
        require!(entry.is_usable(), AccrueError::CollateralNotAllowed);
        Ok(*entry)
    }

    pub fn enabled_destination_entry(&self, mint: &Pubkey) -> Result<DestinationEntry> {
        let entry = self
            .destination_entry(mint)
            .ok_or(AccrueError::DestinationNotAllowed)?;
        require!(entry.is_usable(), AccrueError::DestinationNotAllowed);
        Ok(*entry)
    }

    pub fn upsert_collateral(&mut self, entry: CollateralEntry) -> Result<()> {
        require!(
            entry.mint != Pubkey::default() && entry.reserve != Pubkey::default(),
            AccrueError::CollateralEntryIncomplete
        );
        require!(
            is_known_token_program(&entry.token_program),
            AccrueError::UnknownTokenProgram
        );
        require!(
            entry.scope_price_account != Pubkey::default(),
            AccrueError::CollateralEntryIncomplete
        );

        if let Some(existing) = self
            .allowed_collateral
            .iter_mut()
            .find(|candidate| candidate.mint == entry.mint)
        {
            *existing = entry;
            return Ok(());
        }

        require!(
            self.allowed_collateral.len() < MAX_ALLOWED_COLLATERAL,
            AccrueError::AllowListFull
        );
        self.allowed_collateral.push(entry);
        Ok(())
    }

    pub fn upsert_destination(&mut self, entry: DestinationEntry) -> Result<()> {
        require!(
            entry.mint != Pubkey::default(),
            AccrueError::DestinationEntryIncomplete
        );
        require!(
            is_known_token_program(&entry.token_program),
            AccrueError::UnknownTokenProgram
        );
        require!(
            entry.scope_price_account != Pubkey::default(),
            AccrueError::DestinationEntryIncomplete
        );

        if let Some(existing) = self
            .allowed_destinations
            .iter_mut()
            .find(|candidate| candidate.mint == entry.mint)
        {
            *existing = entry;
            return Ok(());
        }

        require!(
            self.allowed_destinations.len() < MAX_ALLOWED_DESTINATIONS,
            AccrueError::AllowListFull
        );
        self.allowed_destinations.push(entry);
        Ok(())
    }

    pub fn set_borrow_side(&mut self, mint: Pubkey, reserve: Pubkey) -> Result<()> {
        require_keys_neq!(mint, Pubkey::default(), AccrueError::BorrowSideIncomplete);
        require_keys_neq!(
            reserve,
            Pubkey::default(),
            AccrueError::BorrowSideIncomplete
        );
        self.borrow_mint = mint;
        self.borrow_reserve = reserve;
        Ok(())
    }

    pub fn require_opens_allowed(&self) -> Result<()> {
        require!(!self.sunset, AccrueError::ProgramIsRetiring);
        require!(!self.open_paused, AccrueError::OpensArePaused);
        Ok(())
    }

    pub fn require_grows_allowed(&self) -> Result<()> {
        require!(!self.grow_paused, AccrueError::GrowsArePaused);
        Ok(())
    }
}
