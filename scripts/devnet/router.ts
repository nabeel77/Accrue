import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
} from '@solana-program/token-2022';
import {
  AccountRole,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';

import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findSandboxPoolAddress,
  findSandboxSwapAuthority,
  SYSTEM_PROGRAM_ADDRESS,
} from '@accrue/solana';

import {
  accountExists,
  adminSigner,
  connectToDevnet,
  mergeIntoRegistry,
  namedSigner,
  reportSignature,
  reportStep,
  sendInstructions,
  type Cluster,
} from './shared.js';
import { mintKeypairName, tokenProgramAddress } from './mints.js';
import { currentPrices } from './priceBook.js';
import { tokenBySymbol, wholeUnits, type SandboxToken } from './tokens.js';

const INITIALIZE_POOL_TAG = 0;
const FUND_TAG = 1;
const SET_RATE_TAG = 2;
const PRICE_SCALE = 1_000_000;

// Both directions of the one pair the sandbox swaps: USDC in and out of the yield token.
export const SANDBOX_PAIRS: readonly (readonly [string, string])[] = [
  ['USDC', 'ONyc'],
  ['ONyc', 'USDC'],
];

const VAULT_FUNDING = { USDC: 500_000, ONyc: 500_000 } as const;
const VAULT_FLOOR = { USDC: 100_000, ONyc: 100_000 } as const;

export interface VaultReading {
  readonly symbol: string;
  readonly vault: Address;
  readonly wholeUnitsHeld: number;
  readonly floor: number;
  readonly isUnderTheFloor: boolean;
}

function unsigned(value: bigint, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let remaining = value;
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function tagged(tag: number, words: readonly bigint[]): Uint8Array {
  const bytes = new Uint8Array(1 + words.length * 8);
  bytes[0] = tag;
  words.forEach((word, index) => {
    bytes.set(unsigned(word, 8), 1 + index * 8);
  });
  return bytes;
}

// How many whole output tokens one whole input token buys, at the prices the oracle is holding.
export function rateBetween(
  input: SandboxToken,
  output: SandboxToken,
  prices: Record<string, number>,
): { numerator: bigint; denominator: bigint } {
  const priceIn = prices[input.symbol] ?? input.startingPrice;
  const priceOut = prices[output.symbol] ?? output.startingPrice;
  return {
    numerator: BigInt(Math.round(priceIn * PRICE_SCALE)),
    denominator: BigInt(Math.round(priceOut * PRICE_SCALE)),
  };
}

export async function vaultFor(
  swapProgram: Address,
  token: SandboxToken,
): Promise<Address> {
  const authority = await findSandboxSwapAuthority(swapProgram);
  const mint = (await namedSigner(mintKeypairName(token))).address;
  const [vault] = await findAssociatedTokenPda({
    owner: authority,
    mint,
    tokenProgram: tokenProgramAddress(token),
  });
  return vault;
}

async function initializePoolInstruction(
  swapProgram: Address,
  admin: KeyPairSigner,
  input: SandboxToken,
  output: SandboxToken,
  rate: { numerator: bigint; denominator: bigint },
): Promise<Instruction> {
  const inputMint = (await namedSigner(mintKeypairName(input))).address;
  const outputMint = (await namedSigner(mintKeypairName(output))).address;
  return {
    programAddress: swapProgram,
    accounts: [
      { address: admin.address, role: AccountRole.WRITABLE_SIGNER },
      {
        address: await findSandboxPoolAddress(swapProgram, inputMint, outputMint),
        role: AccountRole.WRITABLE,
      },
      {
        address: await findSandboxSwapAuthority(swapProgram),
        role: AccountRole.READONLY,
      },
      { address: inputMint, role: AccountRole.READONLY },
      { address: outputMint, role: AccountRole.READONLY },
      { address: await vaultFor(swapProgram, input), role: AccountRole.WRITABLE },
      { address: await vaultFor(swapProgram, output), role: AccountRole.WRITABLE },
      { address: tokenProgramAddress(input), role: AccountRole.READONLY },
      { address: tokenProgramAddress(output), role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: tagged(INITIALIZE_POOL_TAG, [rate.numerator, rate.denominator]),
  };
}

async function setRateInstruction(
  swapProgram: Address,
  admin: KeyPairSigner,
  input: SandboxToken,
  output: SandboxToken,
  rate: { numerator: bigint; denominator: bigint },
): Promise<Instruction> {
  const inputMint = (await namedSigner(mintKeypairName(input))).address;
  const outputMint = (await namedSigner(mintKeypairName(output))).address;
  return {
    programAddress: swapProgram,
    accounts: [
      { address: admin.address, role: AccountRole.READONLY_SIGNER },
      {
        address: await findSandboxPoolAddress(swapProgram, inputMint, outputMint),
        role: AccountRole.WRITABLE,
      },
    ],
    data: tagged(SET_RATE_TAG, [rate.numerator, rate.denominator]),
  };
}

async function fundInstruction(
  swapProgram: Address,
  admin: KeyPairSigner,
  token: SandboxToken,
  amount: bigint,
): Promise<Instruction> {
  const mint = (await namedSigner(mintKeypairName(token))).address;
  const tokenProgram = tokenProgramAddress(token);
  const [source] = await findAssociatedTokenPda({
    owner: admin.address,
    mint,
    tokenProgram,
  });
  return {
    programAddress: swapProgram,
    accounts: [
      { address: admin.address, role: AccountRole.READONLY_SIGNER },
      { address: source, role: AccountRole.WRITABLE },
      { address: await vaultFor(swapProgram, token), role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: tagged(FUND_TAG, [amount]),
  };
}

export async function readThePoolVaults(
  cluster: Cluster,
  swapProgram: Address,
): Promise<VaultReading[]> {
  const readings: VaultReading[] = [];
  for (const [symbol, floor] of Object.entries(VAULT_FLOOR)) {
    const token = tokenBySymbol(symbol);
    const vault = await vaultFor(swapProgram, token);
    const balance = await cluster.rpc
      .getTokenAccountBalance(vault)
      .send()
      .catch(() => null);
    const wholeUnitsHeld = Number(balance?.value.uiAmountString ?? 0);
    readings.push({
      symbol,
      vault,
      wholeUnitsHeld,
      floor,
      isUnderTheFloor: wholeUnitsHeld < floor,
    });
  }
  return readings;
}

export async function topUpThePoolVaultsUnderTheFloor(
  cluster: Cluster,
  admin: KeyPairSigner,
  swapProgram: Address,
): Promise<{ readonly topped: readonly VaultReading[]; readonly signature?: string }> {
  const readings = await readThePoolVaults(cluster, swapProgram);
  const hungry = readings.filter((reading) => reading.isUnderTheFloor);
  if (hungry.length === 0) {
    return { topped: [] };
  }

  const instructions: Instruction[] = [];
  for (const reading of hungry) {
    const token = tokenBySymbol(reading.symbol);
    const backUpTo = VAULT_FUNDING[reading.symbol as keyof typeof VAULT_FUNDING];
    const raw = wholeUnits(token, Math.ceil(backUpTo - reading.wholeUnitsHeld));
    const mint = (await namedSigner(mintKeypairName(token))).address;
    const tokenProgram = tokenProgramAddress(token);
    const [source] = await findAssociatedTokenPda({
      owner: admin.address,
      mint,
      tokenProgram,
    });
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: admin,
        ata: source,
        owner: admin.address,
        mint,
        tokenProgram,
      }),
      getMintToInstruction(
        { mint, token: source, mintAuthority: admin, amount: raw },
        { programAddress: tokenProgram },
      ),
      await fundInstruction(swapProgram, admin, token, raw),
    );
  }
  const signature = await sendInstructions(cluster, admin, instructions);
  return { topped: hungry, signature };
}

// Keeps the router quoting what the oracle is saying.
export async function setThePoolRates(
  cluster: Cluster,
  admin: KeyPairSigner,
  swapProgram: Address,
  prices: Record<string, number>,
): Promise<string | undefined> {
  const instructions: Instruction[] = [];
  for (const [inputSymbol, outputSymbol] of SANDBOX_PAIRS) {
    const input = tokenBySymbol(inputSymbol);
    const output = tokenBySymbol(outputSymbol);
    const inputMint = (await namedSigner(mintKeypairName(input))).address;
    const outputMint = (await namedSigner(mintKeypairName(output))).address;
    const pool = await findSandboxPoolAddress(swapProgram, inputMint, outputMint);
    if (!(await accountExists(cluster, pool))) {
      continue;
    }
    instructions.push(
      await setRateInstruction(
        swapProgram,
        admin,
        input,
        output,
        rateBetween(input, output, prices),
      ),
    );
  }
  if (instructions.length === 0) {
    return undefined;
  }
  return sendInstructions(cluster, admin, instructions, { computeUnitLimit: 60_000 });
}

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const admin = await adminSigner();
  const swapProgram = (await namedSigner('honest-swap')).address;
  const prices = currentPrices();

  reportStep(`swap program        ${swapProgram}`);
  reportStep(`swap authority      ${await findSandboxSwapAuthority(swapProgram)}`);

  const pools: Record<string, string> = {};
  for (const [inputSymbol, outputSymbol] of SANDBOX_PAIRS) {
    const input = tokenBySymbol(inputSymbol);
    const output = tokenBySymbol(outputSymbol);
    const inputMint = (await namedSigner(mintKeypairName(input))).address;
    const outputMint = (await namedSigner(mintKeypairName(output))).address;
    const pool = await findSandboxPoolAddress(swapProgram, inputMint, outputMint);
    pools[`${inputSymbol}-${outputSymbol}`] = pool;

    const rate = rateBetween(input, output, prices);
    const signature = await sendInstructions(cluster, admin, [
      await initializePoolInstruction(swapProgram, admin, input, output, rate),
    ]);
    reportStep(
      `  ${inputSymbol} to ${outputSymbol}  ${pool}  rate ${rate.numerator}/${rate.denominator}`,
    );
    reportSignature(`${inputSymbol} to ${outputSymbol} pool`, signature);
  }

  for (const [symbol, amount] of Object.entries(VAULT_FUNDING)) {
    const token = tokenBySymbol(symbol);
    const vault = await vaultFor(swapProgram, token);
    const raw = wholeUnits(token, amount);
    const mint = (await namedSigner(mintKeypairName(token))).address;
    const tokenProgram = tokenProgramAddress(token);
    const [source] = await findAssociatedTokenPda({
      owner: admin.address,
      mint,
      tokenProgram,
    });
    const signature = await sendInstructions(cluster, admin, [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: admin,
        ata: source,
        owner: admin.address,
        mint,
        tokenProgram,
      }),
      getMintToInstruction(
        { mint, token: source, mintAuthority: admin, amount: raw },
        { programAddress: tokenProgram },
      ),
      await fundInstruction(swapProgram, admin, token, raw),
    ]);
    reportStep(`  vault ${symbol.padEnd(6)} ${vault}  funded with ${amount}`);
    reportSignature(`${symbol} vault funded`, signature);
  }

  mergeIntoRegistry({ pools });
}

if (process.argv[1]?.endsWith('router.ts') === true) {
  await main();
}
