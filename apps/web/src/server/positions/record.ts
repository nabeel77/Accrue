import 'server-only';

import { and, eq } from 'drizzle-orm';

import { createDatabaseClient, schema, type AccrueDatabase } from '@accrue/db';

let database: AccrueDatabase | null = null;

function db(): AccrueDatabase {
  database ??= createDatabaseClient();
  return database;
}

export interface BuildRecord {
  readonly walletAddress: string;
  readonly positionAddress: string;
  readonly marketAddress: string;
  readonly obligationAddress: string;
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
  readonly growEnabled: boolean;
  readonly exitOnFlagEnabled: boolean;
  readonly feeBpsAtOpen: number;
  readonly collateralMint: string;
  readonly collateralDecimals: number;
  readonly collateralAmountRaw: string;
  readonly collateralMultiplierAtOpen: string;
  readonly collateralPriceAtOpen: string;
  readonly borrowMint: string;
  readonly borrowAmountRaw: string;
  readonly borrowApyAtOpen: string;
  readonly destinationMint: string;
  readonly destinationAmountRaw: string;
  readonly destinationApyAtOpen: string;
  readonly ltvAtOpen: string;
  readonly maxLtvAtOpen: string;
  readonly liquidationThresholdAtOpen: string;
  readonly liquidationPriceAtOpen: string;
  readonly ltvOverrideAccepted: boolean;
  readonly blockhashExpiresAt: Date;
}

/**
 * The row is written before anything is signed, with the exact inputs, so a transaction that never
 * lands leaves a record of what was asked for rather than nothing at all.
 */
export async function recordTheBuild(record: BuildRecord): Promise<string | null> {
  try {
    const [row] = await db()
      .insert(schema.positions)
      .values({ ...record, status: 'building' })
      .returning({ id: schema.positions.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function markItOpen(
  wallet: string,
  id: string,
  signatures: readonly string[],
): Promise<void> {
  try {
    await db()
      .update(schema.positions)
      .set({
        status: 'open',
        openSignatures: [...signatures],
        openedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.positions.id, id), eq(schema.positions.walletAddress, wallet)),
      );
  } catch {
    return;
  }
}

export async function markItFailed(
  wallet: string,
  id: string,
  reason: string,
): Promise<void> {
  try {
    await db()
      .update(schema.positions)
      .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
      .where(
        and(eq(schema.positions.id, id), eq(schema.positions.walletAddress, wallet)),
      );
  } catch {
    return;
  }
}
