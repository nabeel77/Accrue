import { and, gte } from 'drizzle-orm';

import { createDatabaseClient, schema } from '@accrue/db';

import { isDevnet, optional } from '../../../server/env.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';

const AN_HOUR_IN_MILLISECONDS = 3_600_000;

export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  const limit = await withinTheLimit('read', 'program', wallet ?? 'anonymous');
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }

  let keepersLastHour = 0;
  try {
    const rows = await createDatabaseClient()
      .select({ id: schema.keeperRuns.id })
      .from(schema.keeperRuns)
      .where(
        and(gte(schema.keeperRuns.at, new Date(Date.now() - AN_HOUR_IN_MILLISECONDS))),
      );
    keepersLastHour = rows.length;
  } catch {
    keepersLastHour = 0;
  }

  return ok({
    programId: optional('ACCRUE_PROGRAM_ID') ?? null,
    cluster: isDevnet() ? 'devnet' : 'mainnet',
    build: optional('ACCRUE_BUILD_HASH') ?? null,
    upgradeAuthority: optional('ACCRUE_UPGRADE_AUTHORITY') ?? null,
    keepersLastHour,
  });
}
