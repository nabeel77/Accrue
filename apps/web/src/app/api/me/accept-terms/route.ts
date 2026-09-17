import { z } from 'zod';

import { acceptTerms } from '../../../../server/gates.js';
import { withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, readBody, refuse, tooMany } from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

const body = z.object({ version: z.number().int().positive() });

export async function POST(request: Request): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuse('Sign in first.', 401);
  }
  const limit = await withinTheLimit('read', 'me/accept-terms', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = await readBody(request, body);
  if ('response' in parsed) {
    return parsed.response;
  }
  if (!(await acceptTerms(wallet, parsed.value.version))) {
    return refuse('Those are not the current terms.', 409);
  }
  return ok({ accepted: true, version: parsed.value.version });
}
