import { numeric, text, timestamp } from 'drizzle-orm/pg-core';

/** Raw on chain amounts, stored exactly as the chain reports them, with the decimals beside them. */
export const rawAmount = (columnName: string) =>
  numeric(columnName, { precision: 40, scale: 0 });

/** Dollar values and rates computed from chain data. */
export const usdAmount = (columnName: string) =>
  numeric(columnName, { precision: 20, scale: 6 });

/** A base58 address. Never a shortened one, and never written to a log. */
export const base58Address = (columnName: string) => text(columnName);

export const instant = (columnName: string) =>
  timestamp(columnName, { withTimezone: true });
