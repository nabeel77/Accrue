export interface StrategyLevels {
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
}

export type StrategyRefusal =
  | 'protectLevelTooHigh'
  | 'targetLevelTooHigh'
  | 'targetLevelTooLow'
  | 'growLevelTooHigh'
  | 'reserveLeavesNoGuardRoom';

// The same five points of room the program keeps between each level.
export const MIN_GUARD_ROOM_BPS = 500;

export function whyTheStrategyIsRefused(
  strategy: StrategyLevels,
  maxLoanToValueBps: number,
  liquidationThresholdBps: number,
): StrategyRefusal | null {
  const highestProtect = liquidationThresholdBps - MIN_GUARD_ROOM_BPS;
  if (highestProtect < 0) {
    return 'reserveLeavesNoGuardRoom';
  }
  if (strategy.protectLtvBps > highestProtect) {
    return 'protectLevelTooHigh';
  }

  const highestTarget = strategy.protectLtvBps - MIN_GUARD_ROOM_BPS;
  if (highestTarget < 0 || strategy.targetLtvBps > highestTarget) {
    return 'targetLevelTooHigh';
  }
  if (strategy.targetLtvBps > maxLoanToValueBps) {
    return 'targetLevelTooHigh';
  }
  if (strategy.targetLtvBps <= 0) {
    return 'targetLevelTooLow';
  }
  if (strategy.growBelowLtvBps >= strategy.targetLtvBps) {
    return 'growLevelTooHigh';
  }
  return null;
}

export const STRATEGY_REFUSAL_MESSAGES: Readonly<Record<StrategyRefusal, string>> = {
  protectLevelTooHigh:
    'The guard level has to sit at least five points under the liquidation threshold.',
  targetLevelTooHigh:
    'The borrow level has to sit at least five points under the guard level and under what the market allows.',
  targetLevelTooLow: 'The borrow level has to be above zero.',
  growLevelTooHigh: 'The grow level has to be under the borrow level.',
  reserveLeavesNoGuardRoom: 'This market leaves no room for a guard.',
};

// What the lending market counts a debt as: its value weighted by the reserve's borrow factor.
export function adjustedDebtValueScaled(
  debtValueScaled: bigint,
  borrowFactorPct: number,
): bigint {
  return (debtValueScaled * BigInt(borrowFactorPct)) / 100n;
}
