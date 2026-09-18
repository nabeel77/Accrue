import { address } from '@solana/kit';

import { positionsOwnedOnChain } from '../../../server/positions/ownedOnChain.js';
import { readOnePosition } from '../../../server/positions/readPositions.js';
import { positionsOf } from '../../../server/positions/list.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, refuseWith, somethingWentWrong, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';

const NEVER_LISTED = ['building', 'failed', 'abandoned'];

// The chain is the list.
export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuseWith('signInFirst', 401);
  }
  const limit = await withinTheLimit('read', 'positions', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }

  try {
    const owned = await positionsOwnedOnChain(address(wallet));
    const rows = await positionsOf(wallet);
    const byAddress = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (row.positionAddress !== null && !NEVER_LISTED.includes(row.status)) {
        byAddress.set(row.positionAddress, row);
      }
    }

    const positions = await Promise.all(
      owned.map(async (entry) => {
        const row = byAddress.get(entry.address) ?? null;
        return {
          id: row?.id ?? entry.address,
          positionAddress: entry.address,
          status: row?.status ?? 'open',
          collateralMint: entry.account.collateralMint,
          destinationMint: entry.account.destinationMint,
          feeBpsAtOpen: row?.feeBpsAtOpen ?? entry.account.feeBpsAtOpen,
          onChain: await readOnePosition(entry.address),
        };
      }),
    );
    return ok({ readAt: new Date().toISOString(), positions });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
