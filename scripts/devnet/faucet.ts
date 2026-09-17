import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
} from '@solana-program/token-2022';
import { address, type Address, type Instruction, type KeyPairSigner } from '@solana/kit';

import {
  adminSigner,
  connectToDevnet,
  namedSigner,
  reportSignature,
  reportStep,
  sendInstructions,
  type Cluster,
} from './shared.js';
import { mintKeypairName, tokenProgramAddress } from './mints.js';
import { SANDBOX_TOKENS, wholeUnits, type SandboxToken } from './tokens.js';

export interface Grant {
  readonly symbol: string;
  readonly amount: string;
  readonly tokenAccount: Address;
}

export interface GrantResult {
  readonly wallet: Address;
  readonly signature: string;
  readonly grants: readonly Grant[];
  readonly lamportsSent: bigint;
}

const LAMPORTS_A_WALLET_NEEDS_FOR_FEES = 50_000_000n;
const LAMPORTS_SENT_WHEN_SHORT = 100_000_000n;

export async function associatedTokenAccount(
  token: SandboxToken,
  mint: Address,
  owner: Address,
): Promise<Address> {
  const [derived] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: tokenProgramAddress(token),
  });
  return derived;
}

/**
 * One grant covers every sandbox token at once, because a wallet that holds a stock token and no
 * USDC cannot repay, and a wallet with no yield token cannot be guarded.
 */
export async function grantTestTokens(
  cluster: Cluster,
  mintAuthority: KeyPairSigner,
  wallet: Address,
): Promise<GrantResult> {
  const instructions: Instruction[] = [];
  const grants: Grant[] = [];

  // A wallet holding every token and no SOL cannot send a single transaction, so the faucet tops
  // the fee balance up as well.
  const { value: lamportsHeld } = await cluster.rpc.getBalance(wallet).send();
  const lamportsSent =
    lamportsHeld < LAMPORTS_A_WALLET_NEEDS_FOR_FEES ? LAMPORTS_SENT_WHEN_SHORT : 0n;
  if (lamportsSent > 0n) {
    instructions.push(
      getTransferSolInstruction({
        source: mintAuthority,
        destination: wallet,
        amount: lamportsSent,
      }),
    );
  }

  for (const token of SANDBOX_TOKENS) {
    const mint = (await namedSigner(mintKeypairName(token))).address;
    const tokenProgram = tokenProgramAddress(token);
    const tokenAccount = await associatedTokenAccount(token, mint, wallet);
    const amount = wholeUnits(token, token.faucetGrant);

    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: mintAuthority,
        ata: tokenAccount,
        owner: wallet,
        mint,
        tokenProgram,
      }),
      getMintToInstruction(
        { mint, token: tokenAccount, mintAuthority, amount },
        { programAddress: tokenProgram },
      ),
    );
    grants.push({
      symbol: token.symbol,
      amount: `${token.faucetGrant}`,
      tokenAccount,
    });
  }

  const signature = await sendInstructions(cluster, mintAuthority, instructions, {
    computeUnitLimit: 300_000,
  });
  return { wallet, signature, grants, lamportsSent };
}

/** The admin key is the mint authority of every sandbox mint, so the faucet mints as the admin. */
export function mintAuthoritySigner(): Promise<KeyPairSigner> {
  return adminSigner();
}

async function main(): Promise<void> {
  const wallet = process.argv[2];
  if (wallet === undefined) {
    throw new Error('Pass the wallet to grant to: pnpm devnet:faucet <address>');
  }
  const cluster = connectToDevnet();
  const mintAuthority = await mintAuthoritySigner();
  const result = await grantTestTokens(cluster, mintAuthority, address(wallet));

  reportStep(`granted to ${result.wallet}`);
  for (const grant of result.grants) {
    reportStep(
      `  ${grant.symbol.padEnd(6)} ${grant.amount.padStart(8)}  ${grant.tokenAccount}`,
    );
  }
  if (result.lamportsSent > 0n) {
    reportStep(`  SOL    ${Number(result.lamportsSent) / 1_000_000_000}`);
  }
  reportSignature('faucet', result.signature);
}

if (process.argv[1]?.endsWith('faucet.ts') === true) {
  await main();
}
