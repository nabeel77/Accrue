import 'server-only';

import type { Address, Base64EncodedWireTransaction, Instruction } from '@solana/kit';

import { compileTheFirstThatFits, currentCluster, NothingFits } from '@accrue/solana';

import { CAPS } from '../env.js';
import { chain } from '../rpc.js';
import { theCallerTakesVersionOne } from './theCaller.js';
import type { BuiltTransaction } from './shape.js';

const COMPUTE_UNIT_LIMIT = 600_000;

export class TheChainRefusedIt extends Error {
  constructor(readonly lastLogLines: string) {
    super(
      `the chain refused that transaction, so it is never offered to sign: ${lastLogLines}`,
    );
    this.name = 'TheChainRefusedIt';
  }
}

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

function theTablesToTry(): Address[] {
  const table = currentCluster().lookupTable;
  return table === null ? [] : [table];
}

// Compiled and measured, sent nowhere.
export async function assemble(
  feePayer: Address,
  instructions: readonly Instruction[],
): Promise<BuiltTransaction> {
  try {
    const compiled = await compileTheFirstThatFits(
      {
        rpc: chain().rpc,
        feePayer,
        computeUnitLimit: COMPUTE_UNIT_LIMIT,
        priorityFeeLamports: BigInt(CAPS.priorityFeeLamports()),
        lookupTables: theTablesToTry(),
        // The wallet that will sign decides the format, not this server and not the endpoint.
        walletTakesVersionOne: theCallerTakesVersionOne(),
      },
      instructions,
    );
    return {
      transaction: compiled.wire,
      version: compiled.version,
      bytes: compiled.bytes,
      uniqueAddresses: compiled.uniqueAddresses,
      computeUnits: null,
      blockhashExpiresAtHeight: compiled.blockhashExpiresAtHeight.toString(),
    };
  } catch (failure) {
    if (failure instanceof NothingFits) {
      throw new TransactionDoesNotFit(failure.bytes, 0);
    }
    throw failure;
  }
}

// Nothing is returned to a browser that did not simulate.
export async function assembleAndSimulate(
  feePayer: Address,
  instructions: readonly Instruction[],
): Promise<BuiltTransaction> {
  const built = await assemble(feePayer, instructions);
  const simulation = await chain()
    .rpc.simulateTransaction(built.transaction as Base64EncodedWireTransaction, {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
    })
    .send();

  if (simulation.value.err !== null) {
    const logs = simulation.value.logs ?? [];
    const kept = process.env['ACCRUE_SHOW_EVERY_LOG'] === 'true' ? logs : logs.slice(-4);
    throw new TheChainRefusedIt(kept.join(' | '));
  }

  return {
    ...built,
    computeUnits: simulation.value.unitsConsumed?.toString() ?? null,
  };
}
