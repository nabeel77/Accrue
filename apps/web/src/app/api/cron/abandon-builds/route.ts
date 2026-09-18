import { and, eq, isNotNull, lt } from 'drizzle-orm';

import { schema } from '@accrue/db';

import { db } from '../../../../server/database.js';

import { cronIsAuthorised } from '../../../../server/cron.js';
import { ok, refuse, somethingWentWrong } from '../../../../server/respond.js';
import { chain } from '../../../../server/rpc.js';

const AN_HOUR_IN_MILLISECONDS = 3_600_000;

// A build that was never signed leaves a row saying a position was coming.
export async function POST(request: Request): Promise<Response> {
  if (!cronIsAuthorised(request)) {
    return refuse('No.', 401);
  }

  try {
    const height = await chain().rpc.getBlockHeight().send();

    const stale = await db()
      .select({
        positionId: schema.transactionBuilds.positionId,
        lastGoodHeight: schema.transactionBuilds.blockhashExpiresAtSlot,
      })
      .from(schema.transactionBuilds)
      .where(
        and(
          isNotNull(schema.transactionBuilds.positionId),
          eq(schema.transactionBuilds.kind, 'open'),
        ),
      );

    let abandoned = 0;
    for (const row of stale) {
      if (row.positionId === null || (row.lastGoodHeight ?? 0n) >= height) {
        continue;
      }
      const changed = await db()
        .update(schema.positions)
        .set({ status: 'abandoned', updatedAt: new Date() })
        .where(
          and(
            eq(schema.positions.id, row.positionId),
            eq(schema.positions.status, 'building'),
          ),
        )
        .returning({ id: schema.positions.id });
      abandoned += changed.length;
    }

    await db()
      .delete(schema.rateLimitBuckets)
      .where(
        lt(
          schema.rateLimitBuckets.windowStart,
          new Date(Date.now() - AN_HOUR_IN_MILLISECONDS),
        ),
      );

    return ok({ abandoned });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
