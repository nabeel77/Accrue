import 'server-only';

import type { Address } from '@solana/kit';

import {
  DESTINATIONS,
  defaultStrategyFor,
  netYieldBps,
  sizeADeposit,
  thePriceIsTooOld,
  type Destination,
  type DepositSizing,
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
  readScopePrice,
  type ReserveReading,
} from '@accrue/solana/kamino';
import { fetchConfig, findConfigPda, PositionState } from '@accrue/solana/program';

import { CAPS } from './env.js';
import { quoteTheBuy } from './exit.js';
import { positionsOf } from './positions/list.js';
import { positionsOwnedOnChain } from './positions/ownedOnChain.js';
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
  readonly netYieldBps: number;
  readonly oraclePriceScaled: string;
  readonly decimals: number;
  // What this wallet holds, raw, or null when nobody is signed in.
  readonly balanceRaw: string | null;
  // The row this wallet already holds in this pair, so a second deposit grows it rather than
  // opening another. Decided here from the chain and the rows, never in the browser.
  readonly openPositionId: string | null;
  readonly openPosition: OpenPositionInThisPair | null;
}

export interface OpenPositionInThisPair {
  readonly id: string;
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growEnabled: boolean;
}

const A_SLOT_IN_MILLISECONDS = 400;
const BASIS_POINTS = 10_000;
const MILLISECONDS_IN_A_SECOND = 1_000;
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
const TOKEN_ACCOUNT_AMOUNT_BYTES = 8;

// The stock balances one wallet holds, read from its own associated token accounts.
// The wallet's open position in each stock, for the destination the screen is showing.
// The chain is the list here too. A row of ours is not a position: one closed on the chain, or
// one that never landed there, must not send this screen down a path that ends at an account
// nobody can read, and a position opened without a row of ours must still be grown rather than
// opened again over its own seeds.
async function theOpenPositionsOf(
  wallet: string | null,
  destinationMint: Address | null,
): Promise<Map<string, OpenPositionInThisPair>> {
  if (wallet === null || destinationMint === null) {
    return new Map();
  }
  const [owned, rows] = await Promise.all([
    positionsOwnedOnChain(wallet as Address),
    positionsOf(wallet),
  ]);
  const idByAddress = new Map(
    rows.flatMap((row) =>
      row.positionAddress === null ? [] : [[row.positionAddress, row.id] as const],
    ),
  );
  return new Map(
    owned.flatMap((entry) =>
      entry.account.state === PositionState.Open &&
      entry.account.destinationMint === destinationMint
        ? [
            [
              entry.account.collateralMint,
              {
                id: idByAddress.get(entry.address) ?? entry.address,
                targetLtvBps: entry.account.strategy.targetLtvBps,
                protectLtvBps: entry.account.strategy.protectLtvBps,
                growEnabled: entry.account.strategy.growEnabled,
              },
            ] as [string, OpenPositionInThisPair],
          ]
        : [],
    ),
  );
}

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
  // The smallest and largest a position may be, in whole dollars, the lower of both limits.
  readonly smallestPositionUsd: number;
  readonly largestPositionUsd: number;
  // The market will not act on a price past the age the program allows, and nor will this screen.
  readonly oraclePriceAgeSeconds: number;
  readonly oraclePriceIsTooOld: boolean;
  // Everything the card and its Details state, worked out here, for the stock and amount it was
  // asked about. Null when the screen has not chosen a stock or an amount yet.
  readonly sizing: DepositSizing | null;
  readonly quotedAtMilliseconds: number | null;
  readonly stocks: readonly StockDefault[];
}

export interface PositionSizeLimits {
  readonly smallestUsd: number;
  readonly largestUsd: number;
  readonly maxPriceAgeSlots: bigint;
}

// One read of the oracle the market prices this collateral from, against the program's own limit.
async function howOldTheOracleIs(
  reserve: ReserveReading,
  maxPriceAgeSlots: bigint,
): Promise<{ seconds: number; tooOld: boolean }> {
  try {
    const price = await readScopePrice(
      chain().rpc,
      reserve.snapshot.scopePriceAccount,
      reserve.snapshot.scopeFeedIndex,
    );
    return {
      seconds: Math.round(
        (Number(price.ageInSlots) * A_SLOT_IN_MILLISECONDS) / MILLISECONDS_IN_A_SECOND,
      ),
      tooOld: thePriceIsTooOld(price.ageInSlots, maxPriceAgeSlots),
    };
  } catch {
    return { seconds: 0, tooOld: false };
  }
}

// The program's own limits bind before the app's, so the screen offers the smaller of the two.
export async function thePositionSizeLimits(): Promise<PositionSizeLimits> {
  try {
    const [configAddress] = await findConfigPda();
    const config = await fetchConfig(chain().rpc, configAddress, {
      commitment: 'confirmed',
    });
    return {
      smallestUsd: Math.max(CAPS.minPositionUsd(), Number(config.data.minPositionUsd)),
      largestUsd: Math.min(CAPS.maxPositionUsd(), Number(config.data.maxPositionUsd)),
      maxPriceAgeSlots: config.data.maxPriceAgeSlots,
    };
  } catch {
    return {
      smallestUsd: CAPS.minPositionUsd(),
      largestUsd: CAPS.maxPositionUsd(),
      maxPriceAgeSlots: 0n,
    };
  }
}

// Everything the Details sheet states, worked out here, with one quote for what the borrowed
// USDC buys. No quote is a missing figure on the sheet, not a refusal.
async function theSizingFor(
  asked: { stockSymbol?: string | undefined; depositUsd?: number | undefined },
  stocks: readonly StockReading[],
  borrow: ReserveReading,
  destination: Destination,
  destinationTargetRateBps: number,
): Promise<{ sizing: DepositSizing | null; quotedAtMilliseconds: number | null }> {
  const chosen = stocks.find(({ token }) => token.symbol === asked.stockSymbol);
  if (chosen === undefined || asked.depositUsd === undefined || asked.depositUsd <= 0) {
    return { sizing: null, quotedAtMilliseconds: null };
  }
  const targetLtvBps = defaultStrategyFor(chosen.reserve.maxLoanToValueBps).targetLtvBps;
  const borrowUsd = (asked.depositUsd * targetLtvBps) / BASIS_POINTS;
  const quote = await quoteTheBuy(destination, borrowUsd);
  return {
    sizing: sizeADeposit(
      asked.depositUsd,
      targetLtvBps,
      destinationTargetRateBps,
      borrow.borrowRateBps,
      quote?.destinationPerUsdc ?? null,
    ),
    quotedAtMilliseconds: quote?.quotedAtMilliseconds ?? null,
  };
}

// The number beside every stock, computed here on every call.
export async function readDefaults(
  destination: Destination,
  destinationTargetRateBps: number,
  destinationTargetSource: string,
  wallet: string | null = null,
  asked: { stockSymbol?: string | undefined; depositUsd?: number | undefined } = {},
): Promise<DefaultsReading> {
  const [stocks, borrow, limits] = await Promise.all([
    readEveryStock(),
    readTheBorrowReserve(),
    thePositionSizeLimits(),
  ]);
  const [balances, oracle, alreadyHeld, sized] = await Promise.all([
    balancesOf(wallet, stocks),
    howOldTheOracleIs(borrow, limits.maxPriceAgeSlots),
    theOpenPositionsOf(wallet, destinationOnThisCluster(destination)),
    theSizingFor(asked, stocks, borrow, destination, destinationTargetRateBps),
  ]);
  return {
    borrowRateBps: borrow.borrowRateBps,
    destinationSymbol: destination.symbol,
    destinationTargetRateBps,
    destinationTargetSource,
    readAt: new Date().toISOString(),
    smallestPositionUsd: limits.smallestUsd,
    largestPositionUsd: limits.largestUsd,
    oraclePriceAgeSeconds: oracle.seconds,
    oraclePriceIsTooOld: oracle.tooOld,
    sizing: sized.sizing,
    quotedAtMilliseconds: sized.quotedAtMilliseconds,
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
        openPositionId: alreadyHeld.get(token.mint)?.id ?? null,
        openPosition: alreadyHeld.get(token.mint) ?? null,
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
