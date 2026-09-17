import { desc, inArray } from 'drizzle-orm';

import { createDatabaseClient, schema } from '@accrue/db';

import { positionsOf } from '../../../server/positions/list.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, refuse, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';

const MOST_EVENTS_SHOWN = 100;

export interface ActivityEntry {
  readonly signature: string;
  readonly positionAddress: string;
  readonly kind: 'protect' | 'grow' | 'leave';
  readonly usdcAmountRaw: string | null;
  readonly destinationAmountRaw: string | null;
  readonly bountyRaw: string | null;
  readonly at: string;
}

/** Only the signed in wallet's own positions, matched by the addresses we already hold for it. */
export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuse('Sign in first.', 401);
  }
  const limit = await withinTheLimit('read', 'activity', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }

  const addresses = (await positionsOf(wallet))
    .map((row) => row.positionAddress)
    .filter((entry): entry is string => entry !== null);
  if (addresses.length === 0) {
    return ok({ events: [] satisfies ActivityEntry[] });
  }

  try {
    const rows = await createDatabaseClient()
      .select({
        signature: schema.guardEvents.signature,
        positionAddress: schema.guardEvents.positionAddress,
        kind: schema.guardEvents.kind,
        usdcAmountRaw: schema.guardEvents.usdcAmountRaw,
        destinationAmountRaw: schema.guardEvents.destinationAmountRaw,
        bountyRaw: schema.guardEvents.bountyRaw,
        at: schema.guardEvents.at,
      })
      .from(schema.guardEvents)
      .where(inArray(schema.guardEvents.positionAddress, addresses))
      .orderBy(desc(schema.guardEvents.at))
      .limit(MOST_EVENTS_SHOWN);

    const events: ActivityEntry[] = rows.map((row) => ({
      signature: row.signature,
      positionAddress: row.positionAddress,
      kind: row.kind,
      usdcAmountRaw: row.usdcAmountRaw,
      destinationAmountRaw: row.destinationAmountRaw,
      bountyRaw: row.bountyRaw,
      at: row.at.toISOString(),
    }));
    return ok({ events });
  } catch {
    return ok({ events: [] satisfies ActivityEntry[] });
  }
}
