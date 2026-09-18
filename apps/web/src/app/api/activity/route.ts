import { address } from '@solana/kit';
import { desc, eq, inArray } from 'drizzle-orm';

import { schema } from '@accrue/db';
import { shortenAddress } from '@accrue/core';

import { db } from '../../../server/database.js';

import { catchUpOnGuardEvents } from '../../../server/guardEvents.js';
import { positionsOwnedOnChain } from '../../../server/positions/ownedOnChain.js';
import { positionsOf } from '../../../server/positions/list.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, refuseWith, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';

const MOST_EVENTS_SHOWN = 100;

export interface ActivityEntry {
  readonly signature: string;
  readonly positionAddress: string;
  readonly kind: 'protect' | 'grow' | 'leave' | 'top-up';
  readonly usdcAmountRaw: string | null;
  readonly destinationAmountRaw: string | null;
  readonly bountyRaw: string | null;
  // Shortened here: a screen never gets a whole address it did not ask for.
  readonly caller: string | null;
  readonly at: string;
}

// A top up is the owner's own transaction rather than a guard action, so it is read from the
// builds this wallet signed and sent.
async function theOwnerActionsOf(wallet: string): Promise<ActivityEntry[]> {
  try {
    const rows = await db()
      .select({
        kind: schema.transactionBuilds.kind,
        signatures: schema.transactionBuilds.signatures,
        submittedAt: schema.transactionBuilds.submittedAt,
        positionId: schema.transactionBuilds.positionId,
      })
      .from(schema.transactionBuilds)
      .where(eq(schema.transactionBuilds.walletAddress, wallet))
      .orderBy(desc(schema.transactionBuilds.submittedAt))
      .limit(MOST_EVENTS_SHOWN);

    const byId = new Map(
      (await positionsOf(wallet)).map((row) => [row.id, row.positionAddress ?? '']),
    );
    return rows.flatMap((row) => {
      const signature = row.signatures?.[0];
      if (row.kind !== 'top-up' || signature === undefined || row.submittedAt === null) {
        return [];
      }
      return [
        {
          signature,
          positionAddress: byId.get(row.positionId ?? '') ?? '',
          kind: 'top-up' as const,
          usdcAmountRaw: null,
          destinationAmountRaw: null,
          bountyRaw: null,
          caller: null,
          at: row.submittedAt.toISOString(),
        },
      ];
    });
  } catch {
    return [];
  }
}

// Only the signed in wallet's own positions, matched by the addresses we already hold for it.
export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuseWith('signInFirst', 401);
  }
  const limit = await withinTheLimit('read', 'activity', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }

  // The chain is the record. Reading it here means this screen never waits on a background job
  // to notice that the guard acted, and a read that fails still shows what is already stored.
  try {
    await catchUpOnGuardEvents();
  } catch (failure) {
    console.error(
      `the guard events could not be caught up: ${failure instanceof Error ? failure.message : 'unknown'}`,
    );
  }

  // The chain is the list. A position opened outside this app, or one whose row we never wrote,
  // still belongs to this wallet and its guard actions are still its own.
  const [owned, rows] = await Promise.all([
    positionsOwnedOnChain(address(wallet)),
    positionsOf(wallet),
  ]);
  const addresses = [
    ...new Set([
      ...owned.map((entry) => entry.address as string),
      ...rows.flatMap((row) =>
        row.positionAddress === null ? [] : [row.positionAddress],
      ),
    ]),
  ];
  if (addresses.length === 0) {
    return ok({ events: [] satisfies ActivityEntry[] });
  }

  try {
    const rows = await db()
      .select({
        signature: schema.guardEvents.signature,
        positionAddress: schema.guardEvents.positionAddress,
        kind: schema.guardEvents.kind,
        usdcAmountRaw: schema.guardEvents.usdcAmountRaw,
        destinationAmountRaw: schema.guardEvents.destinationAmountRaw,
        bountyRaw: schema.guardEvents.bountyRaw,
        callerAddress: schema.guardEvents.callerAddress,
        at: schema.guardEvents.at,
      })
      .from(schema.guardEvents)
      .where(inArray(schema.guardEvents.positionAddress, addresses))
      .orderBy(desc(schema.guardEvents.at))
      .limit(MOST_EVENTS_SHOWN);

    const guarded: ActivityEntry[] = rows.map((row) => ({
      signature: row.signature,
      positionAddress: row.positionAddress,
      kind: row.kind,
      usdcAmountRaw: row.usdcAmountRaw,
      destinationAmountRaw: row.destinationAmountRaw,
      bountyRaw: row.bountyRaw,
      caller: shortenAddress(row.callerAddress),
      at: row.at.toISOString(),
    }));
    const events = [...guarded, ...(await theOwnerActionsOf(wallet))]
      .sort((first, second) => second.at.localeCompare(first.at))
      .slice(0, MOST_EVENTS_SHOWN);
    return ok({ events });
  } catch {
    return ok({ events: [] satisfies ActivityEntry[] });
  }
}
