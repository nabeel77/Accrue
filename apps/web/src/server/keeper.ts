import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { schema } from '@accrue/db';
import { shortenAddress } from '@accrue/core';

import { db } from './database.js';

export interface LastCheck {
  readonly at: string;
  // Shortened here, because a screen never gets a whole address it did not ask for.
  readonly keeper: string | null;
}

// When a keeper last looked at this position, landed or not. A guard nobody runs is a guard that
// is not there, so this is what the guard card says out loud.
export async function theLastCheckOf(
  positionAddress: string | null,
): Promise<LastCheck | null> {
  if (positionAddress === null) {
    return null;
  }
  try {
    const [row] = await db()
      .select({
        at: schema.keeperRuns.at,
        keeperAddress: schema.keeperRuns.keeperAddress,
      })
      .from(schema.keeperRuns)
      .where(eq(schema.keeperRuns.positionAddress, positionAddress))
      .orderBy(desc(schema.keeperRuns.at))
      .limit(1);
    return row === undefined
      ? null
      : {
          at: row.at.toISOString(),
          keeper: row.keeperAddress === null ? null : shortenAddress(row.keeperAddress),
        };
  } catch {
    return null;
  }
}
