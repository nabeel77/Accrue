import { z } from 'zod';

import type { Base64EncodedWireTransaction, Signature } from '@solana/kit';

import { chain } from '../../../../server/rpc.js';
import { withinTheLimit } from '../../../../server/rateLimit.js';
import {
  ok,
  readBody,
  refuse,
  somethingWentWrong,
  tooMany,
} from '../../../../server/respond.js';
import { markItFailed, markItOpen } from '../../../../server/positions/record.js';
import { walletOfTheSession } from '../../../../server/session.js';

const body = z.object({
  buildId: z.uuid().optional(),
  signedTransactions: z.array(z.string().min(1).max(8_000)).min(1).max(3),
});

const CONFIRMATION_ATTEMPTS = 60;
const A_SECOND = 1_000;

async function waitForIt(signature: Signature): Promise<void> {
  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    const { value } = await chain().rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err != null) {
      throw new Error('the chain refused that transaction');
    }
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }
    await new Promise((wake) => setTimeout(wake, A_SECOND));
  }
  throw new Error('that transaction did not confirm in time');
}

/**
 * We never send a transaction the user did not sign: this takes the signed bytes and no more. When
 * the open took two transactions the second only makes sense after the first has landed, so each
 * one is simulated against the chain the one before it left behind, in order.
 */
export async function POST(request: Request): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuse('Sign in first.', 401);
  }
  const limit = await withinTheLimit('submit', 'positions/submit', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = await readBody(request, body);
  if ('response' in parsed) {
    return parsed.response;
  }

  try {
    const signatures: string[] = [];
    for (const signed of parsed.value.signedTransactions) {
      const wire = signed as Base64EncodedWireTransaction;
      const simulation = await chain()
        .rpc.simulateTransaction(wire, {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
        })
        .send();
      if (simulation.value.err !== null) {
        if (parsed.value.buildId !== undefined) {
          await markItFailed(wallet, parsed.value.buildId, 'the chain refused it');
        }
        return refuse('The chain refused that transaction.', 409, {
          landed: signatures,
        });
      }

      const signature = await chain()
        .rpc.sendTransaction(wire, {
          encoding: 'base64',
          preflightCommitment: 'confirmed',
        })
        .send();
      await waitForIt(signature);
      signatures.push(signature);
    }
    if (parsed.value.buildId !== undefined) {
      await markItOpen(wallet, parsed.value.buildId, signatures);
    }
    return ok({ signature: signatures[0], signatures });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
