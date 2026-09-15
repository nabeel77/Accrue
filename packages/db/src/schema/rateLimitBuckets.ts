import { integer, pgTable, text } from 'drizzle-orm/pg-core';

import { instant } from './columnTypes.js';

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text('key').primaryKey(),
  windowStart: instant('window_start').notNull(),
  count: integer('count').notNull().default(0),
}).enableRLS();
