/** The three zones a health bar is painted in, and nothing else uses these words. */
export type HealthZone = 'healthy' | 'caution' | 'danger';

export interface HealthReading {
  readonly zone: HealthZone;
  readonly loanToValueBps: number;
  readonly protectLtvBps: number;
  readonly liquidationThresholdBps: number;
  /** How far the loan to value is from the level the market liquidates at. */
  readonly distanceToLiquidationBps: number;
  /** Where the bar's fill ends, as a share of the way to liquidation. */
  readonly fillBps: number;
}

const BASIS_POINTS = 10_000;
/** Below this share of the way to the guard level a position is simply healthy. */
const CAUTION_STARTS_AT_SHARE_OF_THE_GUARD = 0.8;

export function readHealth(
  loanToValueBps: number,
  protectLtvBps: number,
  liquidationThresholdBps: number,
): HealthReading {
  const cautionFrom = Math.round(protectLtvBps * CAUTION_STARTS_AT_SHARE_OF_THE_GUARD);
  const zone: HealthZone =
    loanToValueBps >= protectLtvBps
      ? 'danger'
      : loanToValueBps >= cautionFrom
        ? 'caution'
        : 'healthy';

  const fill =
    liquidationThresholdBps === 0
      ? 0
      : Math.min(
          Math.round((loanToValueBps / liquidationThresholdBps) * BASIS_POINTS),
          BASIS_POINTS,
        );

  return {
    zone,
    loanToValueBps,
    protectLtvBps,
    liquidationThresholdBps,
    distanceToLiquidationBps: Math.max(liquidationThresholdBps - loanToValueBps, 0),
    fillBps: fill,
  };
}

/** What the stock has to fall before the market liquidates, from where it is now. */
export function fallToLiquidationBps(
  loanToValueBps: number,
  liquidationThresholdBps: number,
): number {
  if (loanToValueBps <= 0 || liquidationThresholdBps <= 0) {
    return BASIS_POINTS;
  }
  const survives = loanToValueBps / liquidationThresholdBps;
  return Math.max(Math.round((1 - survives) * BASIS_POINTS), 0);
}
