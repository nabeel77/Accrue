import 'server-only';

import { usdPerWholeTokenScaled } from '@accrue/core';
import { readScopePrice, type ReserveReading } from '@accrue/solana/kamino';

import { chain } from '../rpc.js';

// A reserve carries the price of its last refresh, and the market refreshes it again inside our
// own transaction. Sizing a borrow against the older figure asks for more than the market will
// allow the moment the stock has moved since, so anything that decides an amount reads the feed
// itself and only falls back to the reserve when the feed cannot be read at all.
export async function theLivePriceOf(reserve: ReserveReading): Promise<bigint> {
  try {
    const price = await readScopePrice(
      chain().rpc,
      reserve.snapshot.scopePriceAccount,
      reserve.snapshot.scopeFeedIndex,
    );
    return usdPerWholeTokenScaled(price.price);
  } catch {
    return reserve.oraclePriceScaled;
  }
}

// The value the market holds for a position, brought up to the price the feed has now. The
// exchange rate between the deposit and what the market counts it as stays out of it: only the
// price has moved since the value was written.
export function atTheLivePrice(
  valueScaled: bigint,
  storedPriceScaled: bigint,
  livePriceScaled: bigint,
): bigint {
  return storedPriceScaled === 0n
    ? valueScaled
    : (valueScaled * livePriceScaled) / storedPriceScaled;
}
