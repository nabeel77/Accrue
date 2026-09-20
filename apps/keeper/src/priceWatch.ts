import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';

import { usdPerWholeTokenScaled } from '@accrue/core';
import { decodeScopePrice } from '@accrue/solana/kamino';

const HOW_OFTEN_MILLISECONDS = 1_000;
const A_SECOND = 1_000;

export type WhyTheRoundRan = 'the interval elapsed' | 'a price crossed a guard level';

export interface PriceSensitivePosition {
  readonly scopePriceAccount: Address;
  readonly scopeFeedIndex: number;
  readonly collateralPriceScaled: bigint;
  readonly loanToValueBps: number;
  readonly protectLtvBps: number;
}

export function loanToValueAtANewPrice(
  watched: PriceSensitivePosition,
  priceScaled: bigint,
): number {
  if (priceScaled <= 0n) {
    return watched.loanToValueBps;
  }
  return Number(
    (BigInt(watched.loanToValueBps) * watched.collateralPriceScaled) / priceScaled,
  );
}

export function hasCrossedItsGuardLevel(
  watched: PriceSensitivePosition,
  priceScaled: bigint,
): boolean {
  return (
    watched.loanToValueBps < watched.protectLtvBps &&
    loanToValueAtANewPrice(watched, priceScaled) >= watched.protectLtvBps
  );
}

async function priceNow(
  rpc: Rpc<SolanaRpcApi>,
  account: Address,
  feedIndex: number,
): Promise<bigint> {
  const response = await rpc.getAccountInfo(account, { encoding: 'base64' }).send();
  if (response.value === null) {
    throw new Error('the price account the guard watches does not exist');
  }
  const bytes = new Uint8Array(Buffer.from(response.value.data[0], 'base64'));
  return usdPerWholeTokenScaled(decodeScopePrice(bytes, feedIndex));
}

export async function waitForTheNextRound(
  rpc: Rpc<SolanaRpcApi>,
  watching: readonly PriceSensitivePosition[],
  intervalSeconds: number,
): Promise<WhyTheRoundRan> {
  const endsAt = Date.now() + intervalSeconds * A_SECOND;
  if (watching.length === 0) {
    await new Promise((wake) => setTimeout(wake, intervalSeconds * A_SECOND));
    return 'the interval elapsed';
  }

  const accounts = [
    ...new Map(
      watching.map((one) => [`${one.scopePriceAccount}:${one.scopeFeedIndex}`, one]),
    ).values(),
  ];

  while (Date.now() < endsAt) {
    await new Promise((wake) =>
      setTimeout(wake, Math.min(HOW_OFTEN_MILLISECONDS, endsAt - Date.now())),
    );
    let crossed = false;
    for (const feed of accounts) {
      const price = await priceNow(rpc, feed.scopePriceAccount, feed.scopeFeedIndex);
      crossed = watching.some(
        (one) =>
          one.scopePriceAccount === feed.scopePriceAccount &&
          one.scopeFeedIndex === feed.scopeFeedIndex &&
          hasCrossedItsGuardLevel(one, price),
      );
      if (crossed) {
        break;
      }
    }
    if (crossed) {
      return 'a price crossed a guard level';
    }
  }
  return 'the interval elapsed';
}
