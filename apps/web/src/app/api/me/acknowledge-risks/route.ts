import { z } from 'zod';

import { acknowledgeRisks } from '../../../../server/gates.js';
import { withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, readBody, refuse, tooMany } from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

const body = z.object({ version: z.number().int().positive() });

export async function POST(request: Request): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuse('Sign in first.', 401);
  }
  const limit = await withinTheLimit('read', 'me/acknowledge-risks', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = await readBody(request, body);
  if ('response' in parsed) {
    return parsed.response;
  }
  if (!(await acknowledgeRisks(wallet, parsed.value.version))) {
    return refuse('That is not the current acknowledgement.', 409);
  }
  return ok({ acknowledged: true, version: parsed.value.version });
}
