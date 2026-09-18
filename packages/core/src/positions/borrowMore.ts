const BASIS_POINTS = 10_000;

export const THE_RISE_THE_EXAMPLE_USES_BPS = 3_500;

export interface BorrowMoreExample {
  readonly tokens: number;
  readonly debtNow: number;
  readonly liquidatedBelowNow: number;
  readonly risenTo: number;
  readonly debtWithItOff: number;
  readonly liquidatedBelowWithItOff: number;
  readonly fallWithItOffBps: number;
  readonly borrowedMore: number;
  readonly debtWithItOn: number;
  readonly liquidatedBelowWithItOn: number;
  readonly fallWithItOnBps: number;
}

export function liquidationPrice(
  tokens: number,
  debt: number,
  liquidationThresholdBps: number,
): number {
  const collateralAtTheThreshold = tokens * (liquidationThresholdBps / BASIS_POINTS);
  return collateralAtTheThreshold <= 0 ? 0 : debt / collateralAtTheThreshold;
}

function fallBps(from: number, to: number): number {
  return from <= 0 ? 0 : Math.max(Math.round((1 - to / from) * BASIS_POINTS), 0);
}

// What switching borrow more on would mean for this position if its stock rose. With it off the
// debt stands still and the rise is all safety. With it on the guard borrows back up to target,
// so the position earns on more and the price it can fall to rises with it.
export function whatBorrowingMoreWouldDo(
  tokens: number,
  priceNow: number,
  debtNow: number,
  targetLtvBps: number,
  liquidationThresholdBps: number,
): BorrowMoreExample | null {
  if (tokens <= 0 || priceNow <= 0 || liquidationThresholdBps <= 0) {
    return null;
  }
  const risenTo = priceNow * (1 + THE_RISE_THE_EXAMPLE_USES_BPS / BASIS_POINTS);
  const debtWithItOn = tokens * risenTo * (targetLtvBps / BASIS_POINTS);
  const borrowedMore = Math.max(debtWithItOn - debtNow, 0);

  return {
    tokens,
    debtNow,
    liquidatedBelowNow: liquidationPrice(tokens, debtNow, liquidationThresholdBps),
    risenTo,
    debtWithItOff: debtNow,
    liquidatedBelowWithItOff: liquidationPrice(tokens, debtNow, liquidationThresholdBps),
    fallWithItOffBps: fallBps(
      risenTo,
      liquidationPrice(tokens, debtNow, liquidationThresholdBps),
    ),
    borrowedMore,
    debtWithItOn: debtNow + borrowedMore,
    liquidatedBelowWithItOn: liquidationPrice(
      tokens,
      debtNow + borrowedMore,
      liquidationThresholdBps,
    ),
    fallWithItOnBps: fallBps(
      risenTo,
      liquidationPrice(tokens, debtNow + borrowedMore, liquidationThresholdBps),
    ),
  };
}
