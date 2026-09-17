import 'server-only';

import { sql } from 'drizzle-orm';

import { createDatabaseClient, schema, type AccrueDatabase } from '@accrue/db';

import { number } from './env.js';

const A_MINUTE_IN_MILLISECONDS = 60_000;

export type LimitName = 'nonce' | 'verify' | 'build' | 'submit' | 'read';

function allowance(limit: LimitName): number {
  switch (limit) {
    case 'nonce':
      return number('RATE_LIMIT_NONCE_PER_IP', 10);
    case 'verify':
      return number('RATE_LIMIT_VERIFY_PER_IP', 10);
    case 'build':
      return number('RATE_LIMIT_BUILD_PER_WALLET', 6);
    case 'submit':
      return number('RATE_LIMIT_SUBMIT_PER_WALLET', 6);
    case 'read':
      return number('RATE_LIMIT_READ_PER_WALLET', 60);
  }
}

let database: AccrueDatabase | null = null;

function db(): AccrueDatabase {
  database ??= createDatabaseClient();
  return database;
}

export interface LimitVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/**
 * One atomic upsert per request, keyed by the route plus the IP for anything unauthenticated and
 * the route plus the wallet for anything that is not. The count never says anything about anyone
 * else.
 */
export async function withinTheLimit(
  limit: LimitName,
  route: string,
  key: string,
): Promise<LimitVerdict> {
  const windowStart = new Date(
    Math.floor(Date.now() / A_MINUTE_IN_MILLISECONDS) * A_MINUTE_IN_MILLISECONDS,
  );
  const bucketKey = `${route}:${key}:${windowStart.getTime()}`;

  const [row] = await db()
    .insert(schema.rateLimitBuckets)
    .values({ key: bucketKey, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: schema.rateLimitBuckets.key,
      set: { count: sql`${schema.rateLimitBuckets.count} + 1` },
    })
    .returning({ count: schema.rateLimitBuckets.count });

  const used = row?.count ?? 1;
  const retryAfterSeconds = Math.max(
    Math.ceil((windowStart.getTime() + A_MINUTE_IN_MILLISECONDS - Date.now()) / 1_000),
    1,
  );
  return { allowed: used <= allowance(limit), retryAfterSeconds };
}

export function callerAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded?.split(',')[0] ?? 'unknown').trim();
}
