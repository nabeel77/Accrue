export interface DefaultStrategy {
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
  // Borrowing more when the stock rises is something the owner switches on, never a default:
  // it earns more and it carries the liquidation price up with the stock.
  readonly growEnabled: boolean;
}

const PERCENT = 100;
const ROUND_TO_PERCENT = 5;
const GUARD_ROOM_PERCENT = 5;
const GROW_BELOW_TARGET_PERCENT = 10;

export function defaultStrategyFor(maxLoanToValueBps: number): DefaultStrategy {
  const maximumPercent = Math.floor(maxLoanToValueBps / PERCENT);
  const targetPercent =
    Math.floor((maximumPercent * 3) / 4 / ROUND_TO_PERCENT) * ROUND_TO_PERCENT;
  const protectPercent = maximumPercent - GUARD_ROOM_PERCENT;
  const growPercent = targetPercent - GROW_BELOW_TARGET_PERCENT;

  return {
    targetLtvBps: targetPercent * PERCENT,
    protectLtvBps: protectPercent * PERCENT,
    growBelowLtvBps: Math.max(growPercent, 0) * PERCENT,
    growEnabled: false,
  };
}

export function netYieldBps(
  targetLtvBps: number,
  destinationTargetRateBps: number,
  borrowRateBps: number,
): number {
  const spread = destinationTargetRateBps - borrowRateBps;
  return Math.round((targetLtvBps * spread) / 10_000);
}

export interface DepositSizing {
  readonly depositUsd: number;
  readonly borrowUsd: number;
  readonly destinationRateBps: number;
  readonly borrowRateBps: number;
  // What the spread pays on the borrowed amount over a year, and what that is of the deposit.
  readonly earningsUsdAYear: number;
  readonly netYieldBps: number;
  // What the borrowed USDC buys of the yield token at the last quote, null when none came back.
  readonly destinationAmount: number | null;
}

const BASIS_POINTS = 10_000;

// The whole middle card's arithmetic in one place: what a deposit borrows and what the spread
// between the yield token and the loan pays on it over a year.
export function sizeADeposit(
  depositUsd: number,
  targetLtvBps: number,
  destinationRateBps: number,
  borrowRateBps: number,
  destinationPerUsdc: number | null = null,
): DepositSizing {
  const borrowUsd = (depositUsd * targetLtvBps) / BASIS_POINTS;
  const spreadBps = destinationRateBps - borrowRateBps;
  return {
    depositUsd,
    borrowUsd,
    destinationRateBps,
    borrowRateBps,
    earningsUsdAYear: (borrowUsd * spreadBps) / BASIS_POINTS,
    netYieldBps: netYieldBps(targetLtvBps, destinationRateBps, borrowRateBps),
    destinationAmount:
      destinationPerUsdc === null ? null : borrowUsd * destinationPerUsdc,
  };
}
