import 'server-only';

import { and, eq } from 'drizzle-orm';

import { createDatabaseClient, schema, type AccrueDatabase } from '@accrue/db';

let database: AccrueDatabase | null = null;

function db(): AccrueDatabase {
  database ??= createDatabaseClient();
  return database;
}

export interface StoredPosition {
  readonly id: string;
  readonly positionAddress: string | null;
  readonly status: string;
  readonly collateralMint: string;
  readonly destinationMint: string;
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
  readonly feeBpsAtOpen: number;
}

/** Everything is scoped to the session's wallet. No route takes a wallet from the caller. */
export async function positionsOf(wallet: string): Promise<StoredPosition[]> {
  try {
    return await db()
      .select({
        id: schema.positions.id,
        positionAddress: schema.positions.positionAddress,
        status: schema.positions.status,
        collateralMint: schema.positions.collateralMint,
        destinationMint: schema.positions.destinationMint,
        targetLtvBps: schema.positions.targetLtvBps,
        protectLtvBps: schema.positions.protectLtvBps,
        growBelowLtvBps: schema.positions.growBelowLtvBps,
        feeBpsAtOpen: schema.positions.feeBpsAtOpen,
      })
      .from(schema.positions)
      .where(eq(schema.positions.walletAddress, wallet));
  } catch {
    return [];
  }
}

/**
 * The cron has no session, so this one is not scoped to a wallet. It is used only to attach a
 * chain event to the row we already have and never to answer a request.
 */
export async function positionByAddress(
  positionAddress: string,
): Promise<{ id: string; destinationMint: string } | null> {
  const [row] = await db()
    .select({
      id: schema.positions.id,
      destinationMint: schema.positions.destinationMint,
    })
    .from(schema.positions)
    .where(eq(schema.positions.positionAddress, positionAddress))
    .limit(1);
  return row ?? null;
}

export async function positionOf(
  wallet: string,
  id: string,
): Promise<StoredPosition | null> {
  const [row] = await db()
    .select({
      id: schema.positions.id,
      positionAddress: schema.positions.positionAddress,
      status: schema.positions.status,
      collateralMint: schema.positions.collateralMint,
      destinationMint: schema.positions.destinationMint,
      targetLtvBps: schema.positions.targetLtvBps,
      protectLtvBps: schema.positions.protectLtvBps,
      growBelowLtvBps: schema.positions.growBelowLtvBps,
      feeBpsAtOpen: schema.positions.feeBpsAtOpen,
    })
    .from(schema.positions)
    .where(and(eq(schema.positions.walletAddress, wallet), eq(schema.positions.id, id)))
    .limit(1);
  return row ?? null;
}
