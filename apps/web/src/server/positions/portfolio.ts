import 'server-only';

import { and, asc, gte, inArray } from 'drizzle-orm';

import {
  breakDownThePortfolio,
  howTheEquityHasMoved,
  theLineToDraw,
  whatThePositionsHaveEarned,
  type APointInTime,
  type PortfolioBreakdown,
  type WhatItHasEarned,
} from '@accrue/core/portfolio';
import { schema } from '@accrue/db';

import { db } from '../database.js';
import { positionsOf } from './list.js';

const MOST_POINTS_ON_THE_LINE = 120;
const A_DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const HOW_FAR_BACK_THE_LINE_GOES_DAYS = 30;

export interface AYieldTokenHolding {
  readonly symbol: string;
  readonly amount: number;
  readonly priceUsd: number;
  readonly valueUsd: number;
}

export interface PortfolioReading {
  readonly breakdown: PortfolioBreakdown;
  readonly earned: WhatItHasEarned;
  readonly holdings: readonly AYieldTokenHolding[];
  readonly changeUsd: number;
  readonly changeBps: number;
  readonly direction: 'up' | 'down' | 'flat';
  readonly line: readonly APointInTime[];
  readonly sinceMilliseconds: number | null;
}

export interface APositionsWorthNow {
  readonly collateralValueUsd: number;
  readonly debtUsd: number;
  readonly destinationValueUsd: number;
}

async function theEquityOverTime(wallet: string): Promise<APointInTime[]> {
  const rows = await positionsOf(wallet);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) {
    return [];
  }
  const since = new Date(
    Date.now() - HOW_FAR_BACK_THE_LINE_GOES_DAYS * A_DAY_IN_MILLISECONDS,
  );
  const snapshots = await db()
    .select({
      takenAt: schema.positionSnapshots.takenAt,
      collateralValueUsd: schema.positionSnapshots.collateralValueUsd,
      debtUsd: schema.positionSnapshots.debtUsd,
      destinationValueUsd: schema.positionSnapshots.destinationValueUsd,
    })
    .from(schema.positionSnapshots)
    .where(
      and(
        inArray(schema.positionSnapshots.positionId, ids),
        gte(schema.positionSnapshots.takenAt, since),
      ),
    )
    .orderBy(asc(schema.positionSnapshots.takenAt));

  const byRound = new Map<number, number>();
  for (const snapshot of snapshots) {
    const at = new Date(snapshot.takenAt).getTime();
    const equity =
      Number(snapshot.collateralValueUsd) +
      Number(snapshot.destinationValueUsd) -
      Number(snapshot.debtUsd);
    byRound.set(at, (byRound.get(at) ?? 0) + equity);
  }
  return [...byRound.entries()]
    .sort(([earlier], [later]) => earlier - later)
    .map(([atMilliseconds, equityUsd]) => ({ atMilliseconds, equityUsd }));
}

export async function readThePortfolio(
  wallet: string,
  positions: readonly APositionsWorthNow[],
  stockInYourWalletUsd: number,
  usdcInYourWalletUsd: number,
  holdings: readonly AYieldTokenHolding[],
): Promise<PortfolioReading> {
  const breakdown = breakDownThePortfolio(
    positions,
    stockInYourWalletUsd,
    usdcInYourWalletUsd,
  );

  let history: APointInTime[] = [];
  try {
    history = await theEquityOverTime(wallet);
  } catch {
    history = [];
  }

  const earliest = history[0];
  const moved = howTheEquityHasMoved(
    earliest?.equityUsd ?? breakdown.positionEquityUsd,
    breakdown.positionEquityUsd,
  );

  return {
    breakdown,
    earned: whatThePositionsHaveEarned(positions),
    holdings,
    changeUsd: moved.changeUsd,
    changeBps: moved.changeBps,
    direction: moved.direction,
    line: theLineToDraw(history, MOST_POINTS_ON_THE_LINE),
    sinceMilliseconds: earliest?.atMilliseconds ?? null,
  };
}
