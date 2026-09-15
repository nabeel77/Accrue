import { BASIS_POINTS_DENOMINATOR } from './money.js';

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

/** What a position has to repay to come back down to its target. Zero when it is already there. */
export function repayToReachTarget(
  borrowedValueScaled: bigint,
  depositedValueScaled: bigint,
  targetLtvBps: number,
): bigint {
  const allowed = valueAllowedAtTarget(depositedValueScaled, targetLtvBps);
  return borrowedValueScaled > allowed ? borrowedValueScaled - allowed : 0n;
}

/** What a position may borrow to come back up to its target. Zero when it is already past it. */
export function borrowToReachTarget(
  borrowedValueScaled: bigint,
  depositedValueScaled: bigint,
  targetLtvBps: number,
): bigint {
  const allowed = valueAllowedAtTarget(depositedValueScaled, targetLtvBps);
  return allowed > borrowedValueScaled ? allowed - borrowedValueScaled : 0n;
}

export function protectAmounts(
  borrowedValueScaled: bigint,
  depositedValueScaled: bigint,
  targetLtvBps: number,
  keeperBountyBps: number,
): ProtectAmounts {
  const repayUsdScaled = repayToReachTarget(
    borrowedValueScaled,
    depositedValueScaled,
    targetLtvBps,
  );
  return {
    repayUsdScaled,
    bountyUsdScaled:
      (repayUsdScaled * BigInt(keeperBountyBps)) / BASIS_POINTS_DENOMINATOR,
  };
}

export function loanToValueBps(
  borrowedValueScaled: bigint,
  depositedValueScaled: bigint,
): number {
  if (depositedValueScaled === 0n) {
    return 0;
  }
  return Number((borrowedValueScaled * BASIS_POINTS_DENOMINATOR) / depositedValueScaled);
}
