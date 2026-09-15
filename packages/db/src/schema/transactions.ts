import {
  bigint,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { base58Address, instant } from './columnTypes.js';
import { transactionKindEnum, transactionStatusEnum } from './enums.js';
import { positions } from './positions.js';
import { wallets } from './wallets.js';

export const transactions = pgTable(
  'transactions',
  {
    signature: text('signature').primaryKey(),
    walletAddress: base58Address('wallet_address')
      .notNull()
      .references(() => wallets.address),
    positionId: uuid('position_id').references(() => positions.id),
    kind: transactionKindEnum('kind').notNull(),
    status: transactionStatusEnum('status').notNull(),
    version: smallint('version').notNull(),
    sizeBytes: integer('size_bytes'),
    uniqueAddressCount: integer('unique_address_count'),
    errorMessage: text('error_message'),
    submittedAt: instant('submitted_at').notNull().defaultNow(),
    confirmedAt: instant('confirmed_at'),
    slot: bigint('slot', { mode: 'bigint' }),
  },
  (table) => [
    index('transactions_wallet_address_index').on(table.walletAddress),
    index('transactions_position_id_index').on(table.positionId),
  ],
).enableRLS();
