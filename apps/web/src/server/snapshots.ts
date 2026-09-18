import 'server-only';

import { desc, eq } from 'drizzle-orm';

import type { Destination } from '@accrue/core';
import { schema } from '@accrue/db';

import { db } from './database.js';

export interface DestinationTarget {
  readonly rateBps: number;
  // Where the figure came from, shown beside it on every screen.
  readonly source: string;
  readonly readAtMilliseconds: number | null;
}

export async function latestDestinationTarget(
  destination: Destination,
): Promise<DestinationTarget> {
  try {
    const [row] = await db()
      .select({
        apy: schema.destinationSnapshots.apy,
        takenAt: schema.destinationSnapshots.takenAt,
        source: schema.destinationSnapshots.source,
      })
      .from(schema.destinationSnapshots)
      .where(eq(schema.destinationSnapshots.destinationMint, destination.mainnetMint))
      .orderBy(desc(schema.destinationSnapshots.takenAt))
      .limit(1);
    if (row !== undefined) {
      return {
        rateBps: Math.round(Number(row.apy) * 100),
        source: row.source,
        readAtMilliseconds: new Date(row.takenAt).getTime(),
      };
    }
  } catch {
    // No database, or no snapshot yet. The config figure is the honest fallback.
  }
  return {
    rateBps: destination.targetRateBps,
    source: destination.targetRateSource,
    readAtMilliseconds: null,
  };
}
