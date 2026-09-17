import 'server-only';

import { desc, eq } from 'drizzle-orm';

import type { Destination } from '@accrue/core';
import { createDatabaseClient, schema, type AccrueDatabase } from '@accrue/db';

let database: AccrueDatabase | null = null;

function db(): AccrueDatabase {
  database ??= createDatabaseClient();
  return database;
}

export interface DestinationTarget {
  readonly rateBps: number;
  /** Where the figure came from, shown beside it on every screen. */
  readonly source: string;
}

/**
 * The latest hourly snapshot if there is one, otherwise the figure recorded in the config with the
 * day it was read. Either way the screen says which.
 */
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
        source: `${row.source}, ${new Date(row.takenAt).toISOString()}`,
      };
    }
  } catch {
    // No database, or no snapshot yet. The config figure is the honest fallback.
  }
  return { rateBps: destination.targetRateBps, source: destination.targetRateSource };
}
