import { getBase58Encoder, isAddress } from '@solana/kit';
import { z } from 'zod';

import { recordInTheAuditLog } from '../../../../server/gates.js';
import { callerAddress, withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, readBody, refuseWith, tooMany } from '../../../../server/respond.js';
import { signInMessage, spendNonce, startSession } from '../../../../server/session.js';

const body = z.object({
  wallet: z.string().refine(isAddress),
  nonce: z.string().min(16).max(128),
  issuedAt: z.string().min(10).max(40),
  signature: z.string().min(64).max(128),
});

export async function POST(request: Request): Promise<Response> {
  const limit = await withinTheLimit('verify', 'auth/verify', callerAddress(request));
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = await readBody(request, body);
  if ('response' in parsed) {
    return parsed.response;
  }
  const { wallet, nonce, issuedAt, signature } = parsed.value;

  if (!(await spendNonce(wallet, nonce))) {
    return refuseWith('signInExpired', 401);
  }

  const encoder = getBase58Encoder();
  const message = new TextEncoder().encode(signInMessage(wallet, nonce, issuedAt));
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(encoder.encode(wallet)),
    'Ed25519',
    false,
    ['verify'],
  );
  const signed = await crypto.subtle.verify(
    'Ed25519',
    key,
    new Uint8Array(encoder.encode(signature)),
    message,
  );
  if (!signed) {
    return refuseWith('signatureDoesNotMatch', 401);
  }

  await startSession(wallet, request.headers.get('user-agent'));
  await recordInTheAuditLog(wallet, 'sign_in', {});
  return ok({ wallet });
}
