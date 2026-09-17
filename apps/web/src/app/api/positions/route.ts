import { address } from '@solana/kit';

import { readOnePosition } from '../../../server/positions/readPositions.js';
import { positionsOf } from '../../../server/positions/list.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, refuse, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';

export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuse('Sign in first.', 401);
  }
  const limit = await withinTheLimit('read', 'positions', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }

  const stored = await positionsOf(wallet);
  const readings = await Promise.all(
    stored.map(async (row) => {
      const onChain =
        row.positionAddress === null
          ? null
          : await readOnePosition(address(row.positionAddress));
      return { ...row, onChain };
    }),
  );
  return ok({ readAt: new Date().toISOString(), positions: readings });
}
