import type { BorrowCurvePoint, ReserveSnapshot } from './layout.js';

const BASIS_POINTS = 10_000n;
const SCALED_FRACTION_ONE = 1n << 60n;
const PERCENT = 100n;

// How much of the reserve's liquidity is lent out, in basis points.
export function utilisationBps(reserve: ReserveSnapshot): number {
  const borrowed = reserve.liquidityBorrowedScaled / SCALED_FRACTION_ONE;
  const total = borrowed + reserve.liquidityAvailableAmount;
  if (total === 0n) {
    return 0;
  }
  return Number((borrowed * BASIS_POINTS) / total);
}

export function borrowRateBps(reserve: ReserveSnapshot): number {
  const at = utilisationBps(reserve);
  const points = usablePoints(reserve.borrowRateCurve);
  if (points.length === 0) {
    return 0;
  }

  const first = points[0];
  if (first === undefined || at <= first.utilisationBps) {
    return first?.borrowRateBps ?? 0;
  }
  for (let index = 1; index < points.length; index += 1) {
    const below = points[index - 1];
    const above = points[index];
    if (below === undefined || above === undefined) {
      continue;
    }
    if (at <= above.utilisationBps) {
      const span = above.utilisationBps - below.utilisationBps;
      if (span <= 0) {
        return above.borrowRateBps;
      }
      const rise = above.borrowRateBps - below.borrowRateBps;
      return Math.round(
        below.borrowRateBps + (rise * (at - below.utilisationBps)) / span,
      );
    }
  }
  return points[points.length - 1]?.borrowRateBps ?? 0;
}

// What a depositor earns: the borrow rate on the lent share, less the market's own cut.
export function supplyRateBps(reserve: ReserveSnapshot): number {
  const paid =
    (BigInt(borrowRateBps(reserve)) * BigInt(utilisationBps(reserve))) / BASIS_POINTS;
  const keptByTheMarket = (paid * BigInt(reserve.protocolTakeRatePct)) / PERCENT;
  return Number(paid - keptByTheMarket);
}

function usablePoints(curve: readonly BorrowCurvePoint[]): BorrowCurvePoint[] {
  const points: BorrowCurvePoint[] = [];
  for (const point of curve) {
    points.push(point);
    if (point.utilisationBps >= Number(BASIS_POINTS)) {
      break;
    }
  }
  return points;
}
