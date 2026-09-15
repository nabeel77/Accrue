import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { base58Address, instant } from './columnTypes.js';
import { guardEventKindEnum, keeperOutcomeEnum } from './enums.js';

export const keeperRuns = pgTable(
  'keeper_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: instant('at').notNull().defaultNow(),
    positionAddress: base58Address('position_address').notNull(),
    kind: guardEventKindEnum('kind').notNull(),
    outcome: keeperOutcomeEnum('outcome').notNull(),
    signature: text('signature'),
    reason: text('reason'),
    durationMs: integer('duration_ms'),
  },
  (table) => [index('keeper_runs_at_index').on(table.at)],
).enableRLS();
