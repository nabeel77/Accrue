import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';

import { findKaminoObligation } from './addresses.js';
import { reserveCaps, type ReserveCaps } from './caps.js';
import {
  decodeLendingMarket,
  decodeObligation,
  decodeReserve,
  decodeScopePrice,
  type LendingMarketSnapshot,
  type ObligationSnapshot,
  type ReserveSnapshot,
  type ScopePrice,
} from './layout.js';
import { borrowRateBps, supplyRateBps, utilisationBps } from './rates.js';

const PERCENT_TO_BASIS_POINTS = 100;
const SCALED_FRACTION_ONE = 1n << 60n;

/** Everything a screen needs about one reserve, read from the reserve itself. */
export interface ReserveReading {
  readonly address: Address;
  readonly snapshot: ReserveSnapshot;
  readonly mint: Address;
  readonly decimals: number;
  /** Read from the reserve, never assumed: the market is the only place these two live. */
  readonly maxLoanToValueBps: number;
  readonly liquidationThresholdBps: number;
  readonly borrowRateBps: number;
  readonly supplyRateBps: number;
  readonly utilisationBps: number;
  /** The price the lending market itself values the collateral at, which a liquidator sees. */
  readonly oraclePriceScaled: bigint;
  readonly availableLiquidity: bigint;
  readonly borrowedAmount: bigint;
  readonly caps: ReserveCaps;
  readonly deleverage: ReserveDeleverageFlags;
}

/** What the market has switched on that could take a position apart without its owner. */
export interface ReserveDeleverageFlags {
  readonly isObsolete: boolean;
  readonly autodeleverageEnabled: boolean;
  readonly depositLimitCrossedAt: bigint;
  readonly borrowLimitCrossedAt: bigint;
  readonly marginCallPeriodSeconds: bigint;
}

export async function fetchAccount(
  rpc: Rpc<SolanaRpcApi>,
  address: Address,
): Promise<Uint8Array> {
  const { value } = await rpc.getAccountInfo(address, { encoding: 'base64' }).send();
  if (value === null) {
    throw new Error('that account is not on this cluster');
  }
  return Uint8Array.from(Buffer.from(value.data[0], 'base64'));
}

export async function readReserve(
  rpc: Rpc<SolanaRpcApi>,
  address: Address,
  nowUnixTimestamp: bigint,
): Promise<ReserveReading> {
  return reserveReadingFrom(
    address,
    decodeReserve(await fetchAccount(rpc, address)),
    nowUnixTimestamp,
  );
}

export function reserveReadingFrom(
  address: Address,
  snapshot: ReserveSnapshot,
  nowUnixTimestamp: bigint,
): ReserveReading {
  return {
    address,
    snapshot,
    mint: snapshot.liquidityMint,
    decimals: snapshot.liquidityMintDecimals,
    maxLoanToValueBps: snapshot.maxLoanToValueBps,
    liquidationThresholdBps: snapshot.liquidationThresholdBps,
    borrowRateBps: borrowRateBps(snapshot),
    supplyRateBps: supplyRateBps(snapshot),
    utilisationBps: utilisationBps(snapshot),
    oraclePriceScaled: snapshot.liquidityMarketPriceScaled,
    availableLiquidity: snapshot.liquidityAvailableAmount,
    borrowedAmount: snapshot.liquidityBorrowedScaled / SCALED_FRACTION_ONE,
    caps: reserveCaps(snapshot, nowUnixTimestamp),
    deleverage: {
      isObsolete: snapshot.isObsolete,
      autodeleverageEnabled: snapshot.autodeleverageEnabled,
      depositLimitCrossedAt: snapshot.depositLimitCrossedTimestamp,
      borrowLimitCrossedAt: snapshot.borrowLimitCrossedTimestamp,
      marginCallPeriodSeconds: snapshot.deleveragingMarginCallPeriodSeconds,
    },
  };
}

export async function readManyReserves(
  rpc: Rpc<SolanaRpcApi>,
  addresses: readonly Address[],
  nowUnixTimestamp: bigint,
): Promise<ReserveReading[]> {
  const readings: ReserveReading[] = [];
  for (const address of addresses) {
    readings.push(await readReserve(rpc, address, nowUnixTimestamp));
  }
  return readings;
}

export async function readLendingMarket(
  rpc: Rpc<SolanaRpcApi>,
  market: Address,
): Promise<LendingMarketSnapshot> {
  return decodeLendingMarket(await fetchAccount(rpc, market));
}

/**
 * Obligations are found from the position address, never from a wallet. A position PDA is the
 * obligation's owner, so this is the only lookup the app needs and it cannot be pointed at
 * somebody else's wallet.
 */
export async function readObligationForPosition(
  rpc: Rpc<SolanaRpcApi>,
  position: Address,
  lendingMarket: Address,
): Promise<{ address: Address; snapshot: ObligationSnapshot } | null> {
  const address = await findKaminoObligation({ owner: position, lendingMarket });
  const { value } = await rpc.getAccountInfo(address, { encoding: 'base64' }).send();
  if (value === null) {
    return null;
  }
  return {
    address,
    snapshot: decodeObligation(Uint8Array.from(Buffer.from(value.data[0], 'base64'))),
  };
}

export interface PriceReading {
  readonly price: ScopePrice;
  /** How many slots old the price is, which is what the program measures staleness in. */
  readonly ageInSlots: bigint;
}

/** The oracle price and its age, read from the account the reserve itself names. */
export async function readScopePrice(
  rpc: Rpc<SolanaRpcApi>,
  scopePriceAccount: Address,
  feedIndex: number,
): Promise<PriceReading> {
  const { value, context } = await rpc
    .getAccountInfo(scopePriceAccount, { encoding: 'base64' })
    .send();
  if (value === null) {
    throw new Error('that oracle account is not on this cluster');
  }
  const price = decodeScopePrice(
    Uint8Array.from(Buffer.from(value.data[0], 'base64')),
    feedIndex,
  );
  const slot = context.slot;
  return {
    price,
    ageInSlots: slot > price.lastUpdatedSlot ? slot - price.lastUpdatedSlot : 0n,
  };
}

export function percentToBasisPoints(percent: number): number {
  return percent * PERCENT_TO_BASIS_POINTS;
}
