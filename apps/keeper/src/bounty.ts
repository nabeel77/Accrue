import {
  type Address,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';
import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';

import { currentCluster, TOKEN_PROGRAM_ADDRESS } from '@accrue/solana';
import { findAssociatedTokenAccount } from '@accrue/solana/kamino';

import type { Sender } from './transaction.js';

export async function theAccountTheBountyIsPaidInto(
  caller: Address,
): Promise<{ mint: Address; account: Address } | null> {
  const mint = currentCluster().mints['USDC'];
  if (mint === undefined) {
    return null;
  }
  return {
    mint,
    account: await findAssociatedTokenAccount({
      owner: caller,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
  };
}

export async function makeSureTheBountyHasSomewhereToLand(
  rpc: Rpc<SolanaRpcApi>,
  feePayer: KeyPairSigner,
  sender: Sender,
): Promise<string | null> {
  const bounty = await theAccountTheBountyIsPaidInto(feePayer.address);
  if (bounty === null) {
    return null;
  }
  const { value } = await rpc
    .getAccountInfo(bounty.account, { encoding: 'base64', commitment: 'confirmed' })
    .send();
  if (value !== null) {
    return null;
  }
  return sender.send(
    getCreateAssociatedTokenIdempotentInstruction({
      payer: feePayer,
      owner: feePayer.address,
      mint: bounty.mint,
      ata: bounty.account,
    }),
  );
}
