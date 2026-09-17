/**
 * Accrue's opinion, one per stock, derived from the market's own maximum so a new reserve needs no
 * new constant: the target is three quarters of the maximum rounded down to a multiple of five,
 * the guard is the maximum less five points, the grow level is the target less ten.
 */
export interface DefaultStrategy {
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
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
  };
}

/**
 * What the stock list shows next to each name: the target loan to value times the spread between
 * the yield token's target and what the loan costs. Computed on every call from live numbers.
 */
export function netYieldBps(
  targetLtvBps: number,
  destinationTargetRateBps: number,
  borrowRateBps: number,
): number {
  const spread = destinationTargetRateBps - borrowRateBps;
  return Math.round((targetLtvBps * spread) / 10_000);
}
