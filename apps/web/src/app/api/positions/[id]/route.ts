import { address } from '@solana/kit';
import { z } from 'zod';

import { positionOf } from '../../../../server/positions/list.js';
import { readOnePosition } from '../../../../server/positions/readPositions.js';
import { withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, refuse, tooMany } from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

const parameters = z.object({ id: z.uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuse('Sign in first.', 401);
  }
  const limit = await withinTheLimit('read', 'positions/id', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = parameters.safeParse(await context.params);
  if (!parsed.success) {
    return refuse('No such position.', 404);
  }

  const stored = await positionOf(wallet, parsed.data.id);
  if (stored === null) {
    return refuse('No such position.', 404);
  }
  const onChain =
    stored.positionAddress === null
      ? null
      : await readOnePosition(address(stored.positionAddress));
  return ok({ readAt: new Date().toISOString(), position: stored, onChain });
}
