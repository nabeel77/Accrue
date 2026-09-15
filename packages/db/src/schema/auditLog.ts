import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { instant } from './columnTypes.js';
import { auditActionEnum } from './enums.js';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: instant('at').notNull().defaultNow(),
    actor: text('actor').notNull(),
    action: auditActionEnum('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (table) => [index('audit_log_at_index').on(table.at)],
).enableRLS();
