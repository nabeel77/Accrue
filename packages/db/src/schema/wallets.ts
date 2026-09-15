import { integer, pgTable } from 'drizzle-orm/pg-core';

import { base58Address, instant } from './columnTypes.js';

export const wallets = pgTable('wallets', {
  address: base58Address('address').primaryKey(),
  firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
  lastSeenAt: instant('last_seen_at').notNull().defaultNow(),
  termsVersion: integer('terms_version'),
  termsAcceptedAt: instant('terms_accepted_at'),
  riskAcknowledgementVersion: integer('risk_acknowledgement_version'),
  riskAcknowledgedAt: instant('risk_acknowledged_at'),
}).enableRLS();
