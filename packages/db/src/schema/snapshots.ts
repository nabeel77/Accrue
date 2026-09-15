import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { base58Address, instant, usdAmount } from './columnTypes.js';

export const marketSnapshots = pgTable(
  'market_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    takenAt: instant('taken_at').notNull().defaultNow(),
    marketAddress: base58Address('market_address').notNull(),
    reserveAddress: base58Address('reserve_address').notNull(),
    tokenMint: base58Address('token_mint').notNull(),
    tokenSymbol: text('token_symbol').notNull(),
    maxLtv: usdAmount('max_ltv').notNull(),
    liquidationThreshold: usdAmount('liquidation_threshold').notNull(),
    borrowApy: usdAmount('borrow_apy').notNull(),
    supplyApy: usdAmount('supply_apy').notNull(),
    totalSupplyUsd: usdAmount('total_supply_usd').notNull(),
    totalBorrowUsd: usdAmount('total_borrow_usd').notNull(),
    availableLiquidityUsd: usdAmount('available_liquidity_usd').notNull(),
    oraclePriceUsd: usdAmount('oracle_price_usd').notNull(),
    source: text('source').notNull(),
  },
  (table) => [
    index('market_snapshots_reserve_taken_at_index').on(
      table.reserveAddress,
      table.takenAt,
    ),
  ],
).enableRLS();

export const destinationSnapshots = pgTable(
  'destination_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    takenAt: instant('taken_at').notNull().defaultNow(),
    destinationMint: base58Address('destination_mint').notNull(),
    apy: usdAmount('apy').notNull(),
    apy30d: usdAmount('apy_30d'),
    tvlUsd: usdAmount('tvl_usd'),
    source: text('source').notNull(),
  },
  (table) => [
    index('destination_snapshots_mint_taken_at_index').on(
      table.destinationMint,
      table.takenAt,
    ),
  ],
).enableRLS();
