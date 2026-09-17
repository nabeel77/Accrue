import { BASIS_POINTS_DENOMINATOR } from '../money.js';

/** The fall every screen stress tests against. */
export const STRESS_FALL_BPS = 2_000;

export interface StressInputs {
  /** What the collateral is worth now, in raw USDC terms. */
  readonly collateralValue: bigint;
  readonly debt: bigint;
  readonly protectLtvBps: number;
  readonly targetLtvBps: number;
  readonly liquidationThresholdBps: number;
  readonly fallBps?: number;
}

export interface StressResult {
  readonly fallBps: number;
  readonly collateralAfter: bigint;
  /** What the guard would repay to come back to target, zero when it does not need to act. */
  readonly protectAmount: bigint;
  readonly debtAfter: bigint;
  readonly loanToValueAfterBps: number;
  readonly distanceToLiquidationBps: number;
  readonly liquidatedBeforeTheGuardCouldAct: boolean;
}

/**
 * The same arithmetic the program does in `repay_to_reach_target`, so a screen never promises
 * something the chain would not do.
 */
export function stressThePosition(inputs: StressInputs): StressResult {
  const fallBps = inputs.fallBps ?? STRESS_FALL_BPS;
  const remaining = BASIS_POINTS_DENOMINATOR - BigInt(fallBps);
  const collateralAfter = (inputs.collateralValue * remaining) / BASIS_POINTS_DENOMINATOR;

  if (collateralAfter === 0n) {
    return {
      fallBps,
      collateralAfter,
      protectAmount: 0n,
      debtAfter: inputs.debt,
      loanToValueAfterBps: Number(BASIS_POINTS_DENOMINATOR),
      distanceToLiquidationBps: 0,
      liquidatedBeforeTheGuardCouldAct: true,
    };
  }

  const loanToValueBps = Number(
    (inputs.debt * BASIS_POINTS_DENOMINATOR) / collateralAfter,
  );
  const liquidatedFirst = loanToValueBps >= inputs.liquidationThresholdBps;

  let protectAmount = 0n;
  let debtAfter = inputs.debt;
  if (!liquidatedFirst && loanToValueBps >= inputs.protectLtvBps) {
    const wantedDebt =
      (collateralAfter * BigInt(inputs.targetLtvBps)) / BASIS_POINTS_DENOMINATOR;
    protectAmount = inputs.debt > wantedDebt ? inputs.debt - wantedDebt : 0n;
    debtAfter = inputs.debt - protectAmount;
  }

  const finalLoanToValueBps = Number(
    (debtAfter * BASIS_POINTS_DENOMINATOR) / collateralAfter,
  );
  return {
    fallBps,
    collateralAfter,
    protectAmount,
    debtAfter,
    loanToValueAfterBps: finalLoanToValueBps,
    distanceToLiquidationBps: Math.max(
      inputs.liquidationThresholdBps - finalLoanToValueBps,
      0,
    ),
    liquidatedBeforeTheGuardCouldAct: liquidatedFirst,
  };
}
