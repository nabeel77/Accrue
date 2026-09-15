import { bigint, boolean, index, pgTable, uuid } from 'drizzle-orm/pg-core';

import { instant, usdAmount } from './columnTypes.js';
import { positionHealthEnum } from './enums.js';
import { positions } from './positions.js';

export const positionSnapshots = pgTable(
  'position_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    positionId: uuid('position_id')
      .notNull()
      .references(() => positions.id),
    takenAt: instant('taken_at').notNull().defaultNow(),
    collateralValueUsd: usdAmount('collateral_value_usd').notNull(),
    debtUsd: usdAmount('debt_usd').notNull(),
    ltv: usdAmount('ltv').notNull(),
    health: positionHealthEnum('health').notNull(),
    aboveProtect: boolean('above_protect').notNull(),
    destinationValueUsd: usdAmount('destination_value_usd').notNull(),
    netEarnedUsd: usdAmount('net_earned_usd').notNull(),
    borrowApy: usdAmount('borrow_apy').notNull(),
    destinationApy: usdAmount('destination_apy').notNull(),
    scopePriceAgeSlots: bigint('scope_price_age_slots', { mode: 'bigint' }),
  },
  (table) => [
    index('position_snapshots_position_id_taken_at_index').on(
      table.positionId,
      table.takenAt,
    ),
  ],
).enableRLS();
