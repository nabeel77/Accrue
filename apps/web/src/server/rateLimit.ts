import 'server-only';

import { sql } from 'drizzle-orm';

import { schema } from '@accrue/db';

import { db } from './database.js';

import { number } from './env.js';
import {
  bucketKey,
  isWithinTheAllowance,
  LIMIT_VARIABLES,
  callerFromForwardedFor,
  retryAfterSeconds,
  theWindowStart,
  type LimitName,
} from './limitRules.js';

export type { LimitName };

function allowance(limit: LimitName): number {
  const { variable, fallback } = LIMIT_VARIABLES[limit];
  return number(variable, fallback);
}

export interface LimitVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export async function withinTheLimit(
  limit: LimitName,
  route: string,
  key: string,
): Promise<LimitVerdict> {
  const now = Date.now();
  const windowStart = new Date(theWindowStart(now));

  const [row] = await db()
    .insert(schema.rateLimitBuckets)
    .values({ key: bucketKey(route, key, windowStart.getTime()), windowStart, count: 1 })
    .onConflictDoUpdate({
      target: schema.rateLimitBuckets.key,
      set: { count: sql`${schema.rateLimitBuckets.count} + 1` },
    })
    .returning({ count: schema.rateLimitBuckets.count });

  const used = row?.count ?? 1;
  return {
    allowed: isWithinTheAllowance(used, allowance(limit)),
    retryAfterSeconds: retryAfterSeconds(windowStart.getTime(), now),
  };
}

export function callerAddress(request: Request): string {
  return callerFromForwardedFor(request.headers.get('x-forwarded-for'));
}
