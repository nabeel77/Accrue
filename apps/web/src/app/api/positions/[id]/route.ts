import { address } from '@solana/kit';

import { catchUpOnGuardEvents } from '../../../../server/guardEvents.js';
import { theLastCheckOf } from '../../../../server/keeper.js';
import { positionForTheOwner } from '../../../../server/positions/list.js';
import { readOnePosition } from '../../../../server/positions/readPositions.js';
import { withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, refuseWith, tooMany } from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuseWith('signInFirst', 401);
  }
  const limit = await withinTheLimit('read', 'positions/id', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const { id } = await context.params;
  const stored = await positionForTheOwner(wallet, id);
  if (stored === null) {
    return refuseWith('notYours', 404);
  }
  const [onChain, lastCheck] = await Promise.all([
    stored.positionAddress === null
      ? null
      : readOnePosition(address(stored.positionAddress)),
    theLastCheckOf(stored.positionAddress),
  ]);
  // A screen that polls this is the fastest place to notice the guard acted, so the events are
  // caught up here too, and a failure to read them never stops the position from being shown.
  void catchUpOnGuardEvents().catch((failure: unknown) => {
    console.error(
      `the guard events could not be caught up: ${failure instanceof Error ? failure.message : 'unknown'}`,
    );
  });

  return ok({
    readAt: new Date().toISOString(),
    position: stored,
    onChain,
    lastCheck,
  });
}
