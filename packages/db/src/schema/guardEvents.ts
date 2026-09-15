import { bigint, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { base58Address, instant, rawAmount } from './columnTypes.js';
import { guardEventKindEnum } from './enums.js';
import { positions } from './positions.js';

export const guardEvents = pgTable(
  'guard_events',
  {
    signature: text('signature').primaryKey(),
    positionId: uuid('position_id').references(() => positions.id),
    positionAddress: base58Address('position_address').notNull(),
    kind: guardEventKindEnum('kind').notNull(),
    callerAddress: base58Address('caller_address').notNull(),
    ltvBeforeBps: integer('ltv_before_bps'),
    ltvAfterBps: integer('ltv_after_bps'),
    usdcAmountRaw: rawAmount('usdc_amount_raw'),
    destinationAmountRaw: rawAmount('destination_amount_raw'),
    bountyRaw: rawAmount('bounty_raw'),
    slot: bigint('slot', { mode: 'bigint' }).notNull(),
    at: instant('at').notNull(),
  },
  (table) => [
    index('guard_events_position_id_at_index').on(table.positionId, table.at),
    index('guard_events_caller_address_at_index').on(table.callerAddress, table.at),
  ],
).enableRLS();
