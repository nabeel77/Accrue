import { BASIS_POINTS_DENOMINATOR } from '../money.js';

// The lending market values the stock when the transaction runs, not when the screen read the
// price, and it refuses any borrow that leaves the position over its own target. A price that
// has moved down in between is enough to do that, so every borrow is sized against a value a
// little under the one the screen was told, and the position lands under its target instead of
// exactly on it.
export const THE_PRICE_MAY_HAVE_MOVED_BPS = 100n;

export function valuedForBorrowing(collateralValueScaled: bigint): bigint {
  return (
    (collateralValueScaled * (BASIS_POINTS_DENOMINATOR - THE_PRICE_MAY_HAVE_MOVED_BPS)) /
    BASIS_POINTS_DENOMINATOR
  );
}
