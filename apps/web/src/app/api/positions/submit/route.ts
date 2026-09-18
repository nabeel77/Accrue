import { z } from 'zod';

import type { Base64EncodedWireTransaction } from '@solana/kit';

import { theQuoteIsStale } from '@accrue/core';

import {
  buildFor,
  markItFailed,
  markItOpen,
  messageBytesOf,
  recordTheSignatures,
} from '../../../../server/positions/record.js';
import {
  everyReason,
  whyTheChainRefused,
} from '../../../../server/positions/whyTheChainRefused.js';
import { chain } from '../../../../server/rpc.js';
import { withinTheLimit } from '../../../../server/rateLimit.js';
import {
  ok,
  readBody,
  refuseWith,
  somethingWentWrong,
  tooMany,
} from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

const body = z.object({
  buildId: z.uuid(),
  signedTransactions: z.array(z.string().min(1).max(8_000)).min(1).max(3).optional(),
  signatures: z.array(z.string().min(32).max(120)).min(1).max(3).optional(),
});

// A blockhash dies at a block height, and past it the chain will not take the transaction at all.
// A read that fails is not an answer, so the send goes ahead and the chain decides.
async function theBlockhashIsPast(lastGoodHeight: bigint | null): Promise<boolean> {
  if (lastGoodHeight === null || lastGoodHeight === 0n) {
    return false;
  }
  try {
    return (await chain().rpc.getBlockHeight().send()) > lastGoodHeight;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuseWith('signInFirst', 401);
  }
  const limit = await withinTheLimit('submit', 'positions/submit', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = await readBody(request, body);
  if ('response' in parsed) {
    return parsed.response;
  }

  const build = await buildFor(wallet, parsed.value.buildId);
  if (build === null) {
    return refuseWith('notYours', 404);
  }

  const sentByTheWallet = parsed.value.signatures;
  if (sentByTheWallet !== undefined) {
    if (sentByTheWallet.length !== build.messages.length) {
      return refuseWith('notTheTransactionWeBuilt', 409);
    }
    await recordTheSignatures(build.id, sentByTheWallet);
    if (build.positionId !== null && build.kind === 'open') {
      await markItOpen(wallet, build.positionId, sentByTheWallet);
    }
    return ok({ signature: sentByTheWallet[0], signatures: sentByTheWallet });
  }

  const signedTransactions = parsed.value.signedTransactions;
  if (signedTransactions === undefined) {
    return refuseWith('notTheTransactionWeBuilt', 400);
  }
  if (signedTransactions.length !== build.messages.length) {
    console.error(
      `a wallet sent ${signedTransactions.length} transactions where ${build.messages.length} were built`,
    );
    return refuseWith('notTheTransactionWeBuilt', 409);
  }
  for (const [index, signed] of signedTransactions.entries()) {
    let given: string;
    try {
      given = messageBytesOf(signed);
    } catch {
      console.error('a wallet sent something that does not decode as a transaction');
      return refuseWith('notTheTransactionWeBuilt', 400);
    }
    if (given !== build.messages[index]) {
      console.error(
        `a wallet changed the message of transaction ${index + 1} of ${build.messages.length}`,
      );
      return refuseWith('notTheTransactionWeBuilt', 409);
    }
  }

  // The blockhash is the harder fact: past it the chain takes nothing, whatever the quote says.
  if (await theBlockhashIsPast(build.blockhashExpiresAtSlot)) {
    return refuseWith('buildExpired', 409);
  }
  if (theQuoteIsStale(build.createdAt.getTime(), Date.now())) {
    return refuseWith('staleQuote', 409);
  }

  try {
    const signatures: string[] = [];
    for (const signed of signedTransactions) {
      signatures.push(
        await chain()
          .rpc.sendTransaction(signed as Base64EncodedWireTransaction, {
            encoding: 'base64',
            preflightCommitment: 'confirmed',
          })
          .send(),
      );
    }
    await recordTheSignatures(build.id, signatures);
    if (build.positionId !== null && build.kind === 'open') {
      await markItOpen(wallet, build.positionId, signatures);
    }
    return ok({ signature: signatures[0], signatures });
  } catch (failure) {
    const why = whyTheChainRefused(failure);
    console.error(`a send did not land: ${everyReason(failure)}`);
    if (build.positionId !== null && build.kind === 'open') {
      await markItFailed(wallet, build.positionId, why ?? 'the chain refused it');
    }
    return why === null ? somethingWentWrong() : refuseWith(why, 409);
  }
}
