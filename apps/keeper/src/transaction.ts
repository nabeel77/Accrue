import {
  getBase64Decoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Base64EncodedWireTransaction,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type Signature,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from '@solana/kit';

import { compileTheFirstThatFits, currentCluster } from '@accrue/solana';

export const GUARD_COMPUTE_UNIT_LIMIT = 600_000;

// Version 1 budgets no account data unless asked, and a guard call loads four programs.
export const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

const CONFIRMATION_ATTEMPTS = 60;
const A_SECOND = 1_000;

export interface Sender {
  send(instruction: Instruction): Promise<string>;
}

export function createSender(
  rpc: Rpc<SolanaRpcApi>,
  _rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  feePayer: KeyPairSigner,
  priorityFeeLamports: number,
): Sender {
  const table = currentCluster().lookupTable;

  return {
    async send(instruction: Instruction): Promise<string> {
      const compiled = await compileTheFirstThatFits(
        {
          rpc,
          feePayer: feePayer.address,
          computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT,
          priorityFeeLamports: BigInt(priorityFeeLamports),
          lookupTables: table === null ? [] : [table],
        },
        [instruction],
      );

      const unsigned = getTransactionDecoder().decode(
        Uint8Array.from(Buffer.from(compiled.wire, 'base64')),
      );
      const signed = await partiallySignTransaction([feePayer.keyPair], unsigned);
      const wire = getBase64Decoder().decode(
        getTransactionEncoder().encode(signed),
      ) as Base64EncodedWireTransaction;

      const signature = await rpc
        .sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' })
        .send();
      await waitForIt(rpc, signature);
      return signature;
    },
  };
}

async function waitForIt(rpc: Rpc<SolanaRpcApi>, signature: Signature): Promise<void> {
  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
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
