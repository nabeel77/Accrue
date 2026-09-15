import { readFileSync } from 'node:fs';

import {
  address,
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessagePriorityFeeLamports,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';

export const CONFIG_SEED = 'config';
const CONFIG_COMPUTE_UNIT_LIMIT = 100_000;

export function requiredVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. Fill it in .env before running this script.`);
  }
  return value;
}

export function requiredNumber(name: string): number {
  const value = Number(requiredVariable(name));
  if (!Number.isFinite(value)) {
    throw new Error(`${name} is not a number.`);
  }
  return value;
}

export function programAddress(): Address {
  return address(requiredVariable('ACCRUE_PROGRAM_ID'));
}

export async function configAddress(): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: programAddress(),
    seeds: [new TextEncoder().encode(CONFIG_SEED)],
  });
  return derived;
}

export async function loadAdminSigner(): Promise<KeyPairSigner> {
  const path = requiredVariable('ADMIN_KEYPAIR_PATH');
  const secret = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return createKeyPairSignerFromBytes(Uint8Array.from(secret));
}

export function shortenAddress(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function sendOneInstruction(
  instruction: Instruction,
  signer: KeyPairSigner,
): Promise<string> {
  const rpcUrl = requiredVariable('HELIUS_RPC_URL');
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace(/^http/u, 'ws'));
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (draft) => setTransactionMessageFeePayerSigner(signer, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, draft),
    (draft) => setTransactionMessageComputeUnitLimit(CONFIG_COMPUTE_UNIT_LIMIT, draft),
    (draft) =>
      setTransactionMessagePriorityFeeLamports(
        BigInt(requiredNumber('PRIORITY_FEE_LAMPORTS')),
        draft,
      ),
    (draft) => appendTransactionMessageInstruction(instruction, draft),
  );

  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
    commitment: 'confirmed',
  });
  return getSignatureFromTransaction(signed);
}
