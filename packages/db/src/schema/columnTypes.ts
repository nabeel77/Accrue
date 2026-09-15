import { numeric, text, timestamp } from 'drizzle-orm/pg-core';

export const rawAmount = (columnName: string) =>
  numeric(columnName, { precision: 40, scale: 0 });

export const usdAmount = (columnName: string) =>
  numeric(columnName, { precision: 20, scale: 6 });

export const base58Address = (columnName: string) => text(columnName);

export const instant = (columnName: string) =>
  timestamp(columnName, { withTimezone: true });
