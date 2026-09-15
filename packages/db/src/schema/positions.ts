import { boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { base58Address, instant, rawAmount, usdAmount } from './columnTypes.js';
import { positionStatusEnum } from './enums.js';
import { wallets } from './wallets.js';

/**
 * What the user did in Accrue and what the numbers were at the time. The chain stays the
 * source of truth for what they own; this table is only the memory around it.
 */
export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAddress: base58Address('wallet_address')
      .notNull()
      .references(() => wallets.address),
    status: positionStatusEnum('status').notNull(),

    positionAddress: base58Address('position_address'),
    marketAddress: base58Address('market_address').notNull(),
    obligationAddress: base58Address('obligation_address'),

    targetLtvBps: integer('target_ltv_bps').notNull(),
    protectLtvBps: integer('protect_ltv_bps').notNull(),
    growBelowLtvBps: integer('grow_below_ltv_bps').notNull(),
    growEnabled: boolean('grow_enabled').notNull(),
    exitOnFlagEnabled: boolean('exit_on_flag_enabled').notNull(),
    feeBpsAtOpen: integer('fee_bps_at_open').notNull(),

    collateralMint: base58Address('collateral_mint').notNull(),
    collateralDecimals: integer('collateral_decimals').notNull(),
    collateralAmountRaw: rawAmount('collateral_amount_raw').notNull(),
    collateralMultiplierAtOpen: usdAmount('collateral_multiplier_at_open').notNull(),
    collateralPriceAtOpen: usdAmount('collateral_price_at_open').notNull(),

    borrowMint: base58Address('borrow_mint').notNull(),
    borrowAmountRaw: rawAmount('borrow_amount_raw').notNull(),
    borrowApyAtOpen: usdAmount('borrow_apy_at_open').notNull(),

    destinationMint: base58Address('destination_mint').notNull(),
    destinationAmountRaw: rawAmount('destination_amount_raw'),
    destinationApyAtOpen: usdAmount('destination_apy_at_open').notNull(),

    ltvAtOpen: usdAmount('ltv_at_open').notNull(),
    maxLtvAtOpen: usdAmount('max_ltv_at_open').notNull(),
    liquidationThresholdAtOpen: usdAmount('liquidation_threshold_at_open').notNull(),
    liquidationPriceAtOpen: usdAmount('liquidation_price_at_open').notNull(),
    ltvOverrideAccepted: boolean('ltv_override_accepted').notNull().default(false),

    blockhashExpiresAt: instant('blockhash_expires_at'),
    openSignatures: jsonb('open_signatures').$type<string[]>(),
    closeSignatures: jsonb('close_signatures').$type<string[]>(),
    failureReason: text('failure_reason'),

    createdAt: instant('created_at').notNull().defaultNow(),
    openedAt: instant('opened_at'),
    closedAt: instant('closed_at'),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('positions_wallet_address_status_index').on(table.walletAddress, table.status),
    index('positions_position_address_index').on(table.positionAddress),
  ],
).enableRLS();
