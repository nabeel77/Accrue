import { index, pgTable, text } from 'drizzle-orm/pg-core';

import { base58Address, instant } from './columnTypes.js';
import { wallets } from './wallets.js';

export const authNonces = pgTable(
  'auth_nonces',
  {
    nonce: text('nonce').primaryKey(),
    walletAddress: base58Address('wallet_address').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    expiresAt: instant('expires_at').notNull(),
    usedAt: instant('used_at'),
  },
  (table) => [index('auth_nonces_expires_at_index').on(table.expiresAt)],
).enableRLS();

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    walletAddress: base58Address('wallet_address')
      .notNull()
      .references(() => wallets.address),
    createdAt: instant('created_at').notNull().defaultNow(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    userAgentHash: text('user_agent_hash'),
  },
  (table) => [index('sessions_wallet_address_index').on(table.walletAddress)],
).enableRLS();
