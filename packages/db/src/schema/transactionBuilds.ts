import { bigint, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { base58Address, instant } from './columnTypes.js';
import { positions } from './positions.js';
import { wallets } from './wallets.js';

export const transactionBuilds = pgTable(
  'transaction_builds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAddress: base58Address('wallet_address')
      .notNull()
      .references(() => wallets.address),
    positionId: uuid('position_id').references(() => positions.id),
    kind: text('kind').notNull(),
    messages: jsonb('messages').$type<string[]>().notNull(),
    signatures: jsonb('signatures').$type<string[]>(),
    blockhashExpiresAtSlot: bigint('blockhash_expires_at_slot', { mode: 'bigint' }),
    createdAt: instant('created_at').notNull().defaultNow(),
    submittedAt: instant('submitted_at'),
  },
  (table) => [
    index('transaction_builds_wallet_created_index').on(
      table.walletAddress,
      table.createdAt,
    ),
  ],
).enableRLS();
