import { isAddress } from '@solana/kit';
import { z } from 'zod';

import { callerAddress, withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, readQuery, tooMany } from '../../../../server/respond.js';
import { issueNonce } from '../../../../server/session.js';

const query = z.object({ wallet: z.string().refine(isAddress) });

export async function GET(request: Request): Promise<Response> {
  const limit = await withinTheLimit('nonce', 'auth/nonce', callerAddress(request));
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = readQuery(request, query);
  if ('response' in parsed) {
    return parsed.response;
  }
  const issued = await issueNonce(parsed.value.wallet);
  return ok({
    nonce: issued.nonce,
    issuedAt: issued.issuedAt,
    message: issued.message,
  });
}
