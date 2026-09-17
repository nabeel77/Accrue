import 'server-only';

import {
  appendTransactionMessageInstructions,
  compileTransaction,
  compileTransactionMessage,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  type Base64EncodedWireTransaction,
  type Address,
  type Instruction,
} from '@solana/kit';

import { PRIMARY_TRANSACTION_VERSION } from '@accrue/solana';

import { CAPS } from '../env.js';
import { chain } from '../rpc.js';
import type { BuiltTransaction } from './shape.js';

const COMPUTE_UNIT_LIMIT = 600_000;
const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;
export const VERSION_ONE_BYTE_LIMIT = 4_096;
export const VERSION_ONE_ADDRESS_LIMIT = 64;

export class TransactionDoesNotFit extends Error {
  constructor(
    readonly bytes: number,
    readonly uniqueAddresses: number,
  ) {
    super(
      `a transaction of ${bytes} bytes naming ${uniqueAddresses} addresses is more than this endpoint takes`,
    );
    this.name = 'TransactionDoesNotFit';
  }
}

async function compileOne(
  feePayer: Address,
  instructions: readonly Instruction[],
): Promise<BuiltTransaction> {
  const { value: latestBlockhash, context } = await chain()
    .rpc.getLatestBlockhash()
    .send();

  const message = pipe(
    createTransactionMessage({ version: PRIMARY_TRANSACTION_VERSION }),
    (draft) => setTransactionMessageFeePayer(feePayer, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, draft),
    (draft) => setTransactionMessageComputeUnitLimit(COMPUTE_UNIT_LIMIT, draft),
    (draft) =>
      setTransactionMessagePriorityFeeLamports(BigInt(CAPS.priorityFeeLamports()), draft),
    (draft) =>
      setTransactionMessageLoadedAccountsDataSizeLimit(
        LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
        draft,
      ),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
  );

  const base64 = getBase64EncodedWireTransaction(compileTransaction(message));

  return {
    transaction: base64,
    version: 1,
    bytes: Buffer.from(base64, 'base64').length,
    uniqueAddresses: compileTransactionMessage(message).staticAccounts.length,
    computeUnits: null,
    blockhashExpiresAtSlot: context.slot.toString(),
  };
}

/** Compiled and measured, sent nowhere. This is how the assembler learns which path fits. */
export async function assemble(
  feePayer: Address,
  instructions: readonly Instruction[],
): Promise<BuiltTransaction> {
  const built = await compileOne(feePayer, instructions);
  if (
    built.bytes > VERSION_ONE_BYTE_LIMIT ||
    built.uniqueAddresses > VERSION_ONE_ADDRESS_LIMIT
  ) {
    throw new TransactionDoesNotFit(built.bytes, built.uniqueAddresses);
  }
  return built;
}

/**
 * Version 1 is the primary path: every address inline, the compute limit, the priority fee and the
 * account data size in the header. Nothing is returned to a browser that did not simulate.
 */
export async function assembleAndSimulate(
  feePayer: Address,
  instructions: readonly Instruction[],
): Promise<BuiltTransaction> {
  const built = await assemble(feePayer, instructions);
  let simulation;
  try {
    simulation = await chain()
      .rpc.simulateTransaction(built.transaction as Base64EncodedWireTransaction, {
        encoding: 'base64',
        sigVerify: false,
        replaceRecentBlockhash: true,
      })
      .send();
  } catch (failure) {
    // Version 1 allows four kilobytes, but an endpoint running an older node still decodes with
    // the old packet limit and says so, which is the signal to compile a path that fits it.
    if (failure instanceof Error && failure.message.includes('too large')) {
      throw new TransactionDoesNotFit(built.bytes, built.uniqueAddresses);
    }
    throw failure;
  }

  if (simulation.value.err !== null) {
    const lastLines = (simulation.value.logs ?? []).slice(-4).join(' | ');
    throw new Error(
      `the chain refused that transaction, so it is never offered to sign: ${lastLines}`,
    );
  }

  return {
    ...built,
    computeUnits: simulation.value.unitsConsumed?.toString() ?? null,
  };
}
