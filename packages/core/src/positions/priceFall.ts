const BASIS_POINTS = 10_000;

export function priceFallToReachBps(targetLtvBps: number, lineLtvBps: number): number {
  if (targetLtvBps <= 0 || lineLtvBps <= 0 || targetLtvBps >= lineLtvBps) {
    return 0;
  }
  return Math.floor(BASIS_POINTS - (targetLtvBps / lineLtvBps) * BASIS_POINTS);
}

export interface TheTwoUnitsOfALine {
  readonly fallBps: number;
  readonly levelBps: number;
}

export function theGuardLine(
  targetLtvBps: number,
  protectLtvBps: number,
): TheTwoUnitsOfALine {
  return {
    fallBps: priceFallToReachBps(targetLtvBps, protectLtvBps),
    levelBps: protectLtvBps,
  };
}

export function theLiquidationLine(
  targetLtvBps: number,
  liquidationThresholdBps: number,
): TheTwoUnitsOfALine {
  return {
    fallBps: priceFallToReachBps(targetLtvBps, liquidationThresholdBps),
    levelBps: liquidationThresholdBps,
  };
}
