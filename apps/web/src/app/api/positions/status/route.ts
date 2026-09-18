import { z } from 'zod';

import type { Signature } from '@solana/kit';

import { theWalletOwnsTheSignature } from '../../../../server/positions/record.js';
import { chain } from '../../../../server/rpc.js';
import { withinTheLimit } from '../../../../server/rateLimit.js';
import {
  ok,
  readQuery,
  refuseWith,
  somethingWentWrong,
  tooMany,
} from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

const query = z.object({ signature: z.string().min(32).max(120) });

export async function GET(request: Request): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuseWith('signInFirst', 401);
  }
  const limit = await withinTheLimit('read', 'positions/status', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = readQuery(request, query);
  if ('response' in parsed) {
    return parsed.response;
  }
  if (!(await theWalletOwnsTheSignature(wallet, parsed.value.signature))) {
    return refuseWith('notYours', 404);
  }

  try {
    const { value } = await chain()
      .rpc.getSignatureStatuses([parsed.value.signature as Signature])
      .send();
    const status = value[0];
    if (status == null) {
      return ok({ state: 'pending' });
    }
    if (status.err !== null) {
      return ok({ state: 'failed' });
    }
    const landed =
      status.confirmationStatus === 'confirmed' ||
      status.confirmationStatus === 'finalized';
    return ok({ state: landed ? 'confirmed' : 'pending' });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
