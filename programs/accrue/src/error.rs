use anchor_lang::prelude::*;

#[error_code]
pub enum AccrueError {
    #[msg("Arithmetic overflowed")]
    MathOverflow,
    #[msg("That account is not owned by the lending market program")]
    NotAKaminoAccount,
    #[msg("The lending market account is shorter than its layout")]
    KaminoAccountTooShort,
    #[msg("A lending market field is outside the range the program can represent")]
    KaminoFieldOutOfRange,
    #[msg("That reserve names no Scope price feed")]
    ReserveHasNoScopeFeed,
    #[msg("That reserve reports a borrow factor of zero")]
    ReserveHasNoBorrowFactor,
    #[msg("That reserve names no farm, so no farm account belongs in this call")]
    ReserveNamesNoFarm,
    #[msg("That reserve names a farm and the farm accounts were not passed")]
    FarmAccountMissing,
    #[msg("That is not the farm account the reserve names")]
    WrongFarmAccount,
    #[msg("The obligation names a reserve this instruction was not given")]
    ObligationNamesAnUnknownReserve,

    #[msg("The performance fee is above the ceiling written in the program")]
    PerformanceFeeAboveCeiling,
    #[msg("The slippage limit is above the ceiling written in the program")]
    SlippageAboveCeiling,
    #[msg("The keeper bounty is above the ceiling written in the program")]
    KeeperBountyAboveCeiling,
    #[msg("The share of available liquidity is above the ceiling written in the program")]
    ShareOfAvailableAboveCeiling,
    #[msg("The price age is outside the range the program allows")]
    PriceAgeAboveCeiling,
    #[msg("The interval is below the floor written in the program")]
    IntervalBelowFloor,
    #[msg("The minimum position size is above the maximum")]
    PositionSizeLimitsInverted,
    #[msg("That token program is neither Token nor Token 2022")]
    UnknownTokenProgram,
    #[msg("The collateral entry is missing a mint, a reserve or a price account")]
    CollateralEntryIncomplete,
    #[msg("The destination entry is missing a mint or a price account")]
    DestinationEntryIncomplete,
    #[msg("The borrow side needs both a mint and a reserve")]
    BorrowSideIncomplete,
    #[msg("That is not the borrow reserve this position borrowed from")]
    WrongBorrowReserve,
    #[msg("The allow list is full")]
    AllowListFull,

    #[msg("That collateral is not enabled")]
    CollateralNotAllowed,
    #[msg("That destination is not enabled")]
    DestinationNotAllowed,
    #[msg("New positions are paused")]
    OpensArePaused,
    #[msg("Growing is paused")]
    GrowsArePaused,
    #[msg("The program is retiring and will not open new positions")]
    ProgramIsRetiring,

    #[msg("This reserve leaves no room between its liquidation threshold and the guard")]
    ReserveLeavesNoGuardRoom,
    #[msg("The guard level is too close to the liquidation threshold")]
    ProtectLevelTooHigh,
    #[msg("The borrow level is too close to the guard level or above what the market allows")]
    TargetLevelTooHigh,
    #[msg("The borrow level must be above zero")]
    TargetLevelTooLow,
    #[msg("The grow level must sit below the borrow level")]
    GrowLevelTooHigh,

    #[msg("Only the owner of this position may do that")]
    NotThePositionOwner,
    #[msg("This position is not in the state that instruction needs")]
    WrongPositionState,
    #[msg("The position size is outside the limits in the config")]
    PositionSizeOutOfRange,
    #[msg("That borrow would take too large a share of the liquidity left")]
    BorrowTooLargeAShareOfLiquidity,
    #[msg("The resulting loan to value is above the target")]
    LoanToValueAboveTarget,
    #[msg("The position still owes the lending market")]
    DebtStillOutstanding,
    #[msg("The position still holds tokens")]
    TokensStillHeld,

    #[msg("The stock token account changed during an instruction that must not move it")]
    CollateralBalanceMoved,
    #[msg("The obligation collateral changed during a swap")]
    ObligationCollateralMoved,
    #[msg("The swap spent more than it was allowed to")]
    SwapSpentTooMuch,
    #[msg("The swap returned less than the minimum")]
    SwapReturnedTooLittle,
    #[msg("A token left the position for an address that is not allowed")]
    TokenLeftForAForbiddenAddress,
    #[msg("Lamports were taken out of a position account")]
    PositionLamportsTaken,
    #[msg("A position account no longer exists")]
    PositionAccountMissing,
    #[msg("The swap route was handed an account it must never receive")]
    SwapRouteTouchesAForbiddenAccount,
    #[msg("The swap route called a program the constants module does not list")]
    SwapRouteCallsAnUnknownProgram,
    #[msg("The minimum output the caller supplied is below what the oracle allows")]
    MinimumOutputTooLow,
    #[msg("A position token account is no longer owned by the position")]
    PositionTokenAccountOwnerChanged,
    #[msg("A position token account was given a delegate")]
    PositionTokenAccountHasADelegate,
    #[msg("A position token account was given a close authority")]
    PositionTokenAccountHasACloseAuthority,

    #[msg("That account is not owned by the oracle program")]
    NotAScopeAccount,
    #[msg("The oracle account is shorter than its layout")]
    ScopeAccountTooShort,
    #[msg("The oracle price is zero")]
    OraclePriceIsZero,
    #[msg("The oracle price is older than the config allows for a call by anyone")]
    OraclePriceIsStale,
    #[msg("Not enough time has passed since the last time the guard acted")]
    IntervalHasNotElapsed,
    #[msg("The loan to value is below the level the guard acts at")]
    GuardLevelNotReached,
    #[msg("The loan to value is above the level growing is allowed at")]
    GrowLevelExceeded,
    #[msg("Growing is switched off for this position")]
    GrowNotEnabled,
    #[msg("The position holds no destination token to sell")]
    NothingToSell,
    #[msg("There is nothing to borrow before the position reaches its target")]
    NothingToBorrow,
    #[msg("The lending market has not flagged this reserve and the program is not retiring")]
    NoReasonToLeave,
    #[msg("Leaving on a flag is switched off for this position")]
    ExitOnFlagNotEnabled,
    #[msg("The bounty account does not belong to the caller")]
    BountyAccountIsNotTheCallers,

    #[msg("The position has no USDC to swap")]
    NothingToSwap,
    #[msg("The treasury account in the config does not match the one passed")]
    WrongTreasury,
    #[msg("Only the admin key may do that")]
    NotTheAdmin,
    #[msg("Only the guardian or the admin may do that")]
    NotTheGuardianOrAdmin,
}
