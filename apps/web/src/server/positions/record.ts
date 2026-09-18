import 'server-only';

import { and, eq } from 'drizzle-orm';
import { getTransactionDecoder } from '@solana/kit';

import { schema } from '@accrue/db';

import { db } from '../database.js';

import type { BuiltTransaction } from './shape.js';

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

export async function recordThePositionRow(record: BuildRecord): Promise<string | null> {
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

export interface StoredBuild {
  readonly id: string;
  readonly positionId: string | null;
  readonly kind: string;
  readonly messages: string[];
  readonly blockhashExpiresAtSlot: bigint | null;
  // A build is exactly as old as the quote it was built from.
  readonly createdAt: Date;
}

export async function recordTheBuild(input: {
  readonly wallet: string;
  readonly positionId: string | null;
  readonly kind: string;
  readonly built: readonly BuiltTransaction[];
}): Promise<string | null> {
  try {
    const [row] = await db()
      .insert(schema.transactionBuilds)
      .values({
        walletAddress: input.wallet,
        positionId: input.positionId,
        kind: input.kind,
        messages: input.built.map((one) => messageBytesOf(one.transaction)),
        blockhashExpiresAtSlot: BigInt(input.built[0]?.blockhashExpiresAtHeight ?? '0'),
      })
      .returning({ id: schema.transactionBuilds.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function recordTheOwnerBuild(
  wallet: string,
  positionId: string | null,
  built: readonly BuiltTransaction[],
  kind = 'owner',
): Promise<string | null> {
  return recordTheBuild({ wallet, positionId, kind, built });
}

export async function buildFor(wallet: string, id: string): Promise<StoredBuild | null> {
  const [row] = await db()
    .select({
      id: schema.transactionBuilds.id,
      positionId: schema.transactionBuilds.positionId,
      kind: schema.transactionBuilds.kind,
      messages: schema.transactionBuilds.messages,
      blockhashExpiresAtSlot: schema.transactionBuilds.blockhashExpiresAtSlot,
      createdAt: schema.transactionBuilds.createdAt,
    })
    .from(schema.transactionBuilds)
    .where(
      and(
        eq(schema.transactionBuilds.id, id),
        eq(schema.transactionBuilds.walletAddress, wallet),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function recordTheSignatures(
  id: string,
  signatures: readonly string[],
): Promise<void> {
  try {
    await db()
      .update(schema.transactionBuilds)
      .set({ signatures: [...signatures], submittedAt: new Date() })
      .where(eq(schema.transactionBuilds.id, id));
  } catch {
    return;
  }
}

// True when this wallet is the one that built the transaction the signature came from.
export async function theWalletOwnsTheSignature(
  wallet: string,
  signature: string,
): Promise<boolean> {
  try {
    const rows = await db()
      .select({ signatures: schema.transactionBuilds.signatures })
      .from(schema.transactionBuilds)
      .where(eq(schema.transactionBuilds.walletAddress, wallet));
    return rows.some((row) => (row.signatures ?? []).includes(signature));
  } catch {
    return false;
  }
}

export function messageBytesOf(base64Transaction: string): string {
  const decoded = getTransactionDecoder().decode(
    Uint8Array.from(Buffer.from(base64Transaction, 'base64')),
  );
  return Buffer.from(decoded.messageBytes).toString('base64');
}
