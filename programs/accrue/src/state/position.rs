use anchor_lang::prelude::*;

use crate::constants::MIN_GUARD_ROOM_BPS;
use crate::error::AccrueError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum PositionState {
    AwaitingSwap,
    Open,
    Closing,
    Closed,
}

impl PositionState {
    pub fn holds_a_loan(&self) -> bool {
        matches!(self, Self::AwaitingSwap | Self::Open | Self::Closing)
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct Strategy {
    pub target_ltv_bps: u16,
    pub protect_ltv_bps: u16,
    pub grow_below_ltv_bps: u16,
    pub grow_enabled: bool,
    pub exit_on_flag_enabled: bool,
}

impl Strategy {
    pub fn validate_against_reserve(
        &self,
        reserve_max_loan_to_value_bps: u16,
        reserve_liquidation_threshold_bps: u16,
    ) -> Result<()> {
        let highest_protect = reserve_liquidation_threshold_bps
            .checked_sub(MIN_GUARD_ROOM_BPS)
            .ok_or(AccrueError::ReserveLeavesNoGuardRoom)?;
        require!(
            self.protect_ltv_bps <= highest_protect,
            AccrueError::ProtectLevelTooHigh
        );

        let highest_target = self
            .protect_ltv_bps
            .checked_sub(MIN_GUARD_ROOM_BPS)
            .ok_or(AccrueError::TargetLevelTooHigh)?;
        require!(
            self.target_ltv_bps <= highest_target,
            AccrueError::TargetLevelTooHigh
        );
        require!(
            self.target_ltv_bps <= reserve_max_loan_to_value_bps,
            AccrueError::TargetLevelTooHigh
        );
        require!(self.target_ltv_bps > 0, AccrueError::TargetLevelTooLow);

        require!(
            self.grow_below_ltv_bps < self.target_ltv_bps,
            AccrueError::GrowLevelTooHigh
        );

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub collateral_mint: Pubkey,
    pub destination_mint: Pubkey,
    pub market: Pubkey,
    pub obligation: Pubkey,
    pub collateral_token_account: Pubkey,
    pub usdc_token_account: Pubkey,
    pub destination_token_account: Pubkey,
    pub strategy: Strategy,
    pub fee_bps_at_open: u16,
    pub state: PositionState,
    pub opened_at: i64,
    pub last_protect_at: i64,
    pub last_grow_at: i64,
    pub protect_count: u32,
    pub grow_count: u32,
    pub usdc_borrowed_total: u64,
    pub usdc_repaid_total: u64,
    pub bump: u8,
}

impl Position {
    pub fn require_owner(&self, signer: &Pubkey) -> Result<()> {
        require_keys_eq!(self.owner, *signer, AccrueError::NotThePositionOwner);
        Ok(())
    }

    pub fn require_state(&self, expected: PositionState) -> Result<()> {
        require!(self.state == expected, AccrueError::WrongPositionState);
        Ok(())
    }

    pub fn require_not_closed(&self) -> Result<()> {
        require!(
            self.state != PositionState::Closed,
            AccrueError::WrongPositionState
        );
        Ok(())
    }

    pub fn record_borrow(&mut self, amount: u64) -> Result<()> {
        self.usdc_borrowed_total = self
            .usdc_borrowed_total
            .checked_add(amount)
            .ok_or(AccrueError::MathOverflow)?;
        Ok(())
    }

    pub fn record_repay(&mut self, amount: u64) -> Result<()> {
        self.usdc_repaid_total = self
            .usdc_repaid_total
            .checked_add(amount)
            .ok_or(AccrueError::MathOverflow)?;
        Ok(())
    }
}
