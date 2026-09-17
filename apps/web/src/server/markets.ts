import 'server-only';

import type { Address } from '@solana/kit';

import {
  DESTINATIONS,
  defaultStrategyFor,
  netYieldBps,
  type Destination,
} from '@accrue/core';
import {
  collateralAllowlist,
  currentCluster,
  type CollateralToken,
} from '@accrue/solana';
import {
  findAssociatedTokenAccount,
  readManyReserves,
  readReserve,
  type ReserveReading,
} from '@accrue/solana/kamino';

import { chain, nowUnixTimestamp } from './rpc.js';

export interface StockReading {
  readonly token: CollateralToken;
  readonly reserve: ReserveReading;
}

export async function readEveryStock(): Promise<StockReading[]> {
  const tokens = collateralAllowlist();
  const reserves = await readManyReserves(
    chain().rpc,
    tokens.map((token) => token.reserve),
    nowUnixTimestamp(),
  );
  return tokens.flatMap((token, index) => {
    const reserve = reserves[index];
    return reserve === undefined ? [] : [{ token, reserve }];
  });
}

export async function readTheBorrowReserve(): Promise<ReserveReading> {
  const usdc = currentCluster().reserves['USDC'];
  if (usdc === undefined) {
    throw new Error('this cluster has no USDC reserve');
  }
  return readReserve(chain().rpc, usdc, nowUnixTimestamp());
}

export function destinationOnThisCluster(destination: Destination): Address | null {
  return currentCluster().mints[destination.symbol] ?? null;
}

export interface StockDefault {
  readonly symbol: string;
  readonly name: string;
  readonly mint: string;
  readonly reserve: string;
  readonly maxLoanToValueBps: number;
  readonly liquidationThresholdBps: number;
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
  /** Recomputed on every call from the live maximum, the live borrow rate and the token's target. */
  readonly netYieldBps: number;
  readonly oraclePriceScaled: string;
  readonly decimals: number;
  /** What this wallet holds, raw, or null when nobody is signed in. */
  readonly balanceRaw: string | null;
}

const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
const TOKEN_ACCOUNT_AMOUNT_BYTES = 8;

/** The stock balances one wallet holds, read from its own associated token accounts. */
async function balancesOf(
  wallet: string | null,
  stocks: readonly StockReading[],
): Promise<(bigint | null)[]> {
  if (wallet === null) {
    return stocks.map(() => null);
  }
  const owner = wallet as Address;
  const accounts = await Promise.all(
    stocks.map(({ token, reserve }) =>
      findAssociatedTokenAccount({
        owner,
        mint: token.mint,
        tokenProgram: reserve.snapshot.liquidityTokenProgram,
      }),
    ),
  );
  const { value } = await chain()
    .rpc.getMultipleAccounts(accounts, { encoding: 'base64' })
    .send();
  return value.map((account) => {
    if (account === null) {
      return 0n;
    }
    const bytes = Uint8Array.from(Buffer.from(account.data[0], 'base64'));
    let amount = 0n;
    for (let index = TOKEN_ACCOUNT_AMOUNT_BYTES - 1; index >= 0; index -= 1) {
      amount = (amount << 8n) | BigInt(bytes[TOKEN_ACCOUNT_AMOUNT_OFFSET + index] ?? 0);
    }
    return amount;
  });
}

export interface DefaultsReading {
  readonly borrowRateBps: number;
  readonly destinationSymbol: string;
  readonly destinationTargetRateBps: number;
  readonly destinationTargetSource: string;
  readonly readAt: string;
  readonly stocks: readonly StockDefault[];
}

/**
 * The number beside every stock, computed here on every call. Nothing about it is stored, so it
 * moves when the market moves and when the user picks another yield token.
 */
export async function readDefaults(
  destination: Destination,
  destinationTargetRateBps: number,
  destinationTargetSource: string,
  wallet: string | null = null,
): Promise<DefaultsReading> {
  const [stocks, borrow] = await Promise.all([readEveryStock(), readTheBorrowReserve()]);
  const balances = await balancesOf(wallet, stocks);
  return {
    borrowRateBps: borrow.borrowRateBps,
    destinationSymbol: destination.symbol,
    destinationTargetRateBps,
    destinationTargetSource,
    readAt: new Date().toISOString(),
    stocks: stocks.map(({ token, reserve }, index) => {
      const strategy = defaultStrategyFor(reserve.maxLoanToValueBps);
      return {
        symbol: token.symbol,
        name: token.name,
        mint: token.mint,
        reserve: token.reserve,
        maxLoanToValueBps: reserve.maxLoanToValueBps,
        liquidationThresholdBps: reserve.liquidationThresholdBps,
        ...strategy,
        netYieldBps: netYieldBps(
          strategy.targetLtvBps,
          destinationTargetRateBps,
          borrow.borrowRateBps,
        ),
        oraclePriceScaled: reserve.oraclePriceScaled.toString(),
        decimals: reserve.decimals,
        balanceRaw: balances[index]?.toString() ?? null,
      };
    }),
  };
}

export function destinationFor(symbol: string | undefined): Destination {
  const chosen =
    symbol === undefined
      ? DESTINATIONS[0]
      : (DESTINATIONS.find((entry) => entry.symbol === symbol) ?? DESTINATIONS[0]);
  if (chosen === undefined) {
    throw new Error('there are no destinations configured');
  }
  return chosen;
}
