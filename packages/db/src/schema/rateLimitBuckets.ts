import { integer, pgTable, text } from 'drizzle-orm/pg-core';

import { instant } from './columnTypes.js';

/**
 * A sliding window per key, one atomic upsert per request. The key is the route plus a
 * hash of either the IP address or the wallet, so nothing here identifies anyone.
 */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text('key').primaryKey(),
  windowStart: instant('window_start').notNull(),
  count: integer('count').notNull().default(0),
}).enableRLS();
