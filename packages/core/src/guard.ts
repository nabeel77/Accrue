import {
  addTheSlippageBuffer,
  BASIS_POINTS_DENOMINATOR,
  PERCENT_DENOMINATOR,
  rawAmountWorthRoundingDown,
  rawAmountWorthRoundingUp,
  usdValueOfScaled,
} from './money.js';

export interface ProtectAmounts {
  readonly repayUsdScaled: bigint;
  readonly bountyUsdScaled: bigint;
}

function valueAllowedAtTarget(
  depositedValueScaled: bigint,
  targetLtvBps: number,
): bigint {
  return (depositedValueScaled * BigInt(targetLtvBps)) / BASIS_POINTS_DENOMINATOR;
}

function weightedValueAsRealValue(
  weightedValueScaled: bigint,
  borrowFactorPct: number,
  roundUp: boolean,
): bigint {
  if (borrowFactorPct <= 0) {
    throw new Error('that reserve reports a borrow factor of zero');
  }
  const numerator = weightedValueScaled * PERCENT_DENOMINATOR;
  const denominator = BigInt(borrowFactorPct);
  if (!roundUp) {
    return numerator / denominator;
  }
  return numerator % denominator === 0n
    ? numerator / denominator
    : numerator / denominator + 1n;
}

// What a position has to repay to come back down to its target.
export function repayToReachTarget(
  adjustedDebtValueScaled: bigint,
  depositedValueScaled: bigint,
  targetLtvBps: number,
  borrowFactorPct: number,
): bigint {
  const allowed = valueAllowedAtTarget(depositedValueScaled, targetLtvBps);
  const gap = adjustedDebtValueScaled > allowed ? adjustedDebtValueScaled - allowed : 0n;
  return weightedValueAsRealValue(gap, borrowFactorPct, true);
}

// What a position may borrow to come back up to its target.
export function borrowToReachTarget(
  adjustedDebtValueScaled: bigint,
  depositedValueScaled: bigint,
  targetLtvBps: number,
  borrowFactorPct: number,
): bigint {
  const allowed = valueAllowedAtTarget(depositedValueScaled, targetLtvBps);
  const room = allowed > adjustedDebtValueScaled ? allowed - adjustedDebtValueScaled : 0n;
  return weightedValueAsRealValue(room, borrowFactorPct, false);
}

export function protectAmounts(
  adjustedDebtValueScaled: bigint,
  depositedValueScaled: bigint,
  targetLtvBps: number,
  keeperBountyBps: number,
  borrowFactorPct: number,
): ProtectAmounts {
  const repayUsdScaled = repayToReachTarget(
    adjustedDebtValueScaled,
    depositedValueScaled,
    targetLtvBps,
    borrowFactorPct,
  );
  return {
    repayUsdScaled,
    bountyUsdScaled:
      (repayUsdScaled * BigInt(keeperBountyBps)) / BASIS_POINTS_DENOMINATOR,
  };
}

export function loanToValueBps(
  adjustedDebtValueScaled: bigint,
  depositedValueScaled: bigint,
): number {
  if (depositedValueScaled === 0n) {
    return 0;
  }
  return Number(
    (adjustedDebtValueScaled * BASIS_POINTS_DENOMINATOR) / depositedValueScaled,
  );
}

export function performanceFeeOnRealisedProfit(
  usdcFromSalesTotal: bigint,
  usdcRepaidTotal: bigint,
  feeBpsAtOpen: number,
): bigint {
  const profit =
    usdcFromSalesTotal > usdcRepaidTotal ? usdcFromSalesTotal - usdcRepaidTotal : 0n;
  return (profit * BigInt(feeBpsAtOpen)) / BASIS_POINTS_DENOMINATOR;
}

export interface ClosingCost {
  // What the lending market is owed right now, in raw USDC.
  readonly debt: bigint;
  // What the router says the yield token sells for, in raw USDC.
  readonly quotedUsdcOut: bigint;
  // The performance fee written into the position when it opened.
  readonly feeBpsAtOpen: number;
  // The lending market's borrow rate for the year, in basis points.
  readonly borrowRateBps: number;
}

const DAYS_IN_A_YEAR = 365n;

// What the owner should expect to add from their own wallet to close, for the review sheet.
export function usdcNeededToClose(cost: ClosingCost): bigint {
  const interestForADay = divideRoundingUp(
    cost.debt * BigInt(cost.borrowRateBps),
    BASIS_POINTS_DENOMINATOR * DAYS_IN_A_YEAR,
  );
  const fee = performanceFeeOnRealisedProfit(
    cost.quotedUsdcOut,
    cost.debt,
    cost.feeBpsAtOpen,
  );
  const owed = cost.debt + interestForADay + fee;
  return owed > cost.quotedUsdcOut ? owed - cost.quotedUsdcOut : 0n;
}

function divideRoundingUp(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

export interface DeleverageSignals {
  readonly reserveStatusObsolete: boolean;
  readonly programIsRetiring: boolean;
  readonly obligationMarginCallStartedAt: bigint;
  readonly marketAutodeleverageEnabled: boolean;
  readonly reserveAutodeleverageEnabled: boolean;
  readonly depositLimitCrossedAt: bigint;
  readonly borrowLimitCrossedAt: bigint;
  readonly marginCallPeriodSeconds: bigint;
}

function aMarginCallPeriodHasElapsed(
  startedAt: bigint,
  periodSeconds: bigint,
  now: bigint,
): boolean {
  return startedAt !== 0n && now >= startedAt + periodSeconds;
}

export function thereIsAReasonToLeave(
  signals: DeleverageSignals,
  nowUnixTimestamp: bigint,
): boolean {
  if (
    signals.reserveStatusObsolete ||
    signals.programIsRetiring ||
    signals.obligationMarginCallStartedAt !== 0n
  ) {
    return true;
  }

  if (!signals.marketAutodeleverageEnabled || !signals.reserveAutodeleverageEnabled) {
    return false;
  }

  return (
    aMarginCallPeriodHasElapsed(
      signals.depositLimitCrossedAt,
      signals.marginCallPeriodSeconds,
      nowUnixTimestamp,
    ) ||
    aMarginCallPeriodHasElapsed(
      signals.borrowLimitCrossedAt,
      signals.marginCallPeriodSeconds,
      nowUnixTimestamp,
    )
  );
}

export interface ProtectSale {
  readonly adjustedDebtValueScaled: bigint;
  readonly depositedValueScaled: bigint;
  readonly targetLtvBps: number;
  readonly borrowFactorPct: number;
  readonly keeperBountyBps: number;
  readonly keeperBountyCapUsdc: bigint;
  readonly maxSlippageBps: number;
  readonly usdcDecimals: number;
  readonly usdcPriceScaled: bigint;
  readonly destinationDecimals: number;
  readonly destinationPriceScaled: bigint;
  readonly destinationBalance: bigint;
}

// What the guard has to sell to repay its way back to target, the program's own arithmetic.
export function destinationToSellForProtect(sale: ProtectSale): bigint {
  const amounts = protectAmounts(
    sale.adjustedDebtValueScaled,
    sale.depositedValueScaled,
    sale.targetLtvBps,
    sale.keeperBountyBps,
    sale.borrowFactorPct,
  );

  const repayNeeded = rawAmountWorthRoundingUp(
    amounts.repayUsdScaled,
    sale.usdcDecimals,
    sale.usdcPriceScaled,
  );
  const bountyWanted = smaller(
    rawAmountWorthRoundingDown(
      amounts.bountyUsdScaled,
      sale.usdcDecimals,
      sale.usdcPriceScaled,
    ),
    sale.keeperBountyCapUsdc,
  );

  const atTheOraclePrice = rawAmountWorthRoundingUp(
    usdValueOfScaled(repayNeeded + bountyWanted, sale.usdcDecimals, sale.usdcPriceScaled),
    sale.destinationDecimals,
    sale.destinationPriceScaled,
  );

  return smaller(
    addTheSlippageBuffer(atTheOraclePrice, sale.maxSlippageBps),
    sale.destinationBalance,
  );
}

function smaller(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
