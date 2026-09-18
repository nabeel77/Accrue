import { schema } from '@accrue/db';

import { db } from '../../../../server/database.js';

import { cronIsAuthorised } from '../../../../server/cron.js';
import { readEveryStock, readTheBorrowReserve } from '../../../../server/markets.js';
import { currentClusterMarket } from '../../../../server/cluster.js';
import { ok, refuse, somethingWentWrong } from '../../../../server/respond.js';

const SCALED_FRACTION_ONE = 1n << 60n;
const BASIS_POINTS = 10_000;

function asNumber(scaled: bigint): string {
  return (Number(scaled) / Number(SCALED_FRACTION_ONE)).toFixed(6);
}

export async function POST(request: Request): Promise<Response> {
  if (!cronIsAuthorised(request)) {
    return refuse('No.', 401);
  }
  try {
    const [stocks, borrow] = await Promise.all([
      readEveryStock(),
      readTheBorrowReserve(),
    ]);
    const market = currentClusterMarket();
    const rows = [...stocks, { token: null, reserve: borrow }].map((entry) => ({
      marketAddress: market,
      reserveAddress: entry.reserve.address,
      tokenMint: entry.reserve.mint,
      tokenSymbol: entry.token?.symbol ?? 'USDC',
      maxLtv: (entry.reserve.maxLoanToValueBps / BASIS_POINTS).toFixed(6),
      liquidationThreshold: (
        entry.reserve.liquidationThresholdBps / BASIS_POINTS
      ).toFixed(6),
      borrowApy: (entry.reserve.borrowRateBps / BASIS_POINTS).toFixed(6),
      supplyApy: (entry.reserve.supplyRateBps / BASIS_POINTS).toFixed(6),
      totalSupplyUsd: entry.reserve.availableLiquidity.toString(),
      totalBorrowUsd: entry.reserve.borrowedAmount.toString(),
      availableLiquidityUsd: entry.reserve.availableLiquidity.toString(),
      oraclePriceUsd: asNumber(entry.reserve.oraclePriceScaled),
      source: 'reserve account',
    }));
    await db().insert(schema.marketSnapshots).values(rows);
    return ok({ written: rows.length });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
