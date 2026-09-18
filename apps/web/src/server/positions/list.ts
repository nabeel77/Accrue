import 'server-only';

import { address } from '@solana/kit';
import { and, eq } from 'drizzle-orm';

import { schema } from '@accrue/db';

import { db } from '../database.js';

import { positionsOwnedOnChain } from './ownedOnChain.js';

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
  readonly collateralPriceAtOpen: string | null;
}

// Everything is scoped to the session's wallet.
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
        collateralPriceAtOpen: schema.positions.collateralPriceAtOpen,
      })
      .from(schema.positions)
      .where(eq(schema.positions.walletAddress, wallet));
  } catch {
    return [];
  }
}

// The cron has no session, so this one is not scoped to a wallet.
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
      collateralPriceAtOpen: schema.positions.collateralPriceAtOpen,
    })
    .from(schema.positions)
    .where(and(eq(schema.positions.walletAddress, wallet), eq(schema.positions.id, id)))
    .limit(1);
  return row ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// A position is identified by its address once it is on chain, and by its row before that.
export async function positionForTheOwner(
  wallet: string,
  id: string,
): Promise<StoredPosition | null> {
  if (UUID.test(id)) {
    return positionOf(wallet, id);
  }

  const owned = await positionsOwnedOnChain(address(wallet));
  const found = owned.find((entry) => entry.address === id);
  if (found === undefined) {
    return null;
  }
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
      collateralPriceAtOpen: schema.positions.collateralPriceAtOpen,
    })
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.walletAddress, wallet),
        eq(schema.positions.positionAddress, id),
      ),
    )
    .limit(1);

  return (
    row ?? {
      id,
      positionAddress: id,
      status: 'open',
      collateralMint: found.account.collateralMint,
      destinationMint: found.account.destinationMint,
      targetLtvBps: found.account.strategy.targetLtvBps,
      protectLtvBps: found.account.strategy.protectLtvBps,
      growBelowLtvBps: found.account.strategy.growBelowLtvBps,
      feeBpsAtOpen: found.account.feeBpsAtOpen,
      collateralPriceAtOpen: null,
    }
  );
}
