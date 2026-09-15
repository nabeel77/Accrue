import {
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from '@solana/kit';

import { PRIMARY_TRANSACTION_VERSION } from '@accrue/solana';

export const GUARD_COMPUTE_UNIT_LIMIT = 600_000;

/**
 * A version 1 transaction budgets zero bytes of account data unless it asks for a limit, so every
 * guard call states one. The guard loads four programs and the market's reserves and price
 * account, so it asks for what a legacy transaction is given without asking.
 */
export const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

export interface Sender {
  send(instruction: Instruction): Promise<string>;
}

export function createSender(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  feePayer: KeyPairSigner,
  priorityFeeLamports: number,
): Sender {
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  return {
    async send(instruction: Instruction): Promise<string> {
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
      const message = pipe(
        createTransactionMessage({ version: PRIMARY_TRANSACTION_VERSION }),
        (draft) => setTransactionMessageFeePayerSigner(feePayer, draft),
        (draft) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, draft),
        (draft) => setTransactionMessageComputeUnitLimit(GUARD_COMPUTE_UNIT_LIMIT, draft),
        (draft) =>
          setTransactionMessageLoadedAccountsDataSizeLimit(
            LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
            draft,
          ),
        (draft) =>
          setTransactionMessagePriorityFeeLamports(BigInt(priorityFeeLamports), draft),
        (draft) => appendTransactionMessageInstruction(instruction, draft),
      );

      const signed = await signTransactionMessageWithSigners(message);
      assertIsTransactionWithBlockhashLifetime(signed);
      await sendAndConfirm(signed, { commitment: 'confirmed' });
      return getSignatureFromTransaction(signed);
    },
  };
}
