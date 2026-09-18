import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import {
  addSignersToTransactionMessage,
  compileTransactionMessage,
  getBase64EncodedWireTransaction,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getSignatureFromTransaction,
  pipe,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessagePriorityFeeLamports,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';

import { shortenAddress } from '@accrue/core';

const DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_KEYPAIR_DIRECTORY = '~/.config/accrue/devnet';
const DEFAULT_ADMIN_KEYPAIR_PATH = '~/.config/solana/id.json';
const DEFAULT_COMPUTE_UNIT_LIMIT = 400_000;
const DEFAULT_PRIORITY_FEE_LAMPORTS = 50_000n;
// Version one budgets no account data at all unless it is asked to, and every one of these scripts
// loads whole programs.
const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;
const REGISTRY_FILE = 'addresses.json';
const SEND_ATTEMPTS = 6;
const CONFIRMATION_ATTEMPTS = 60;
const CONFIRMATION_POLL_MILLISECONDS = 800;
const BACKOFF_MILLISECONDS = 1_500;

export const EXPLORER_CLUSTER_QUERY = '?cluster=devnet';

export interface DevnetRegistry {
  readonly programs?: Record<string, string>;
  readonly mints?: Record<string, string>;
  readonly prices?: string;
  readonly market?: string;
  readonly reserves?: Record<string, string>;
  readonly pools?: Record<string, string>;
  readonly treasury?: string;
  readonly admin?: string;
  readonly lookupTable?: string;
}

export function expandHome(path: string): string {
  return path.startsWith('~') ? resolve(homedir(), path.slice(2)) : resolve(path);
}

export function devnetDirectory(): string {
  const directory = expandHome(
    process.env['DEVNET_KEYPAIR_DIR'] ?? DEFAULT_KEYPAIR_DIRECTORY,
  );
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function devnetRpcUrl(): string {
  return process.env['HELIUS_RPC_URL'] ?? DEFAULT_DEVNET_RPC_URL;
}

export interface Cluster {
  readonly rpc: Rpc<SolanaRpcApi>;
}

// Reads and confirmations both go over plain requests.
export function connectToDevnet(): Cluster {
  return { rpc: createSolanaRpc(devnetRpcUrl()) };
}

export function keypairPath(name: string): string {
  return resolve(devnetDirectory(), `${name}-keypair.json`);
}

export async function loadSignerFromFile(path: string): Promise<KeyPairSigner> {
  const secret = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return createKeyPairSignerFromBytes(Uint8Array.from(secret));
}

// The same sixty four byte file the Solana CLI writes: the seed, then the public key.
export async function namedSigner(name: string): Promise<KeyPairSigner> {
  const path = keypairPath(name);
  if (existsSync(path)) {
    return loadSignerFromFile(path);
  }
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const publicKey = getAddressEncoder().encode(signer.address);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...seed, ...publicKey]));
  return signer;
}

export async function adminSigner(): Promise<KeyPairSigner> {
  return loadSignerFromFile(
    expandHome(process.env['ADMIN_KEYPAIR_PATH'] ?? DEFAULT_ADMIN_KEYPAIR_PATH),
  );
}

export function registryPath(): string {
  return resolve(devnetDirectory(), REGISTRY_FILE);
}

export function readRegistry(): DevnetRegistry {
  const path = registryPath();
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, 'utf8')) as DevnetRegistry;
}

export function mergeIntoRegistry(patch: DevnetRegistry): DevnetRegistry {
  const current = readRegistry();
  const merged: DevnetRegistry = {
    ...current,
    ...patch,
    programs: { ...current.programs, ...patch.programs },
    mints: { ...current.mints, ...patch.mints },
    reserves: { ...current.reserves, ...patch.reserves },
    pools: { ...current.pools, ...patch.pools },
  };
  writeFileSync(registryPath(), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

export function registryAddress(
  registry: DevnetRegistry,
  group: 'programs' | 'mints' | 'reserves' | 'pools',
  name: string,
): Address {
  const entry = registry[group]?.[name];
  if (entry === undefined) {
    throw new Error(`${group}.${name} is not in ${registryPath()} yet.`);
  }
  return entry as Address;
}

export function explorerLink(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER_QUERY}`;
}

export function explorerAddressLink(value: string): string {
  return `https://explorer.solana.com/address/${value}${EXPLORER_CLUSTER_QUERY}`;
}

export interface SendOptions {
  readonly computeUnitLimit?: number;
  readonly extraSigners?: readonly KeyPairSigner[];
}

function looksTemporary(failure: unknown): boolean {
  const message = failure instanceof Error ? failure.message : String(failure);
  return (
    message.includes('429') ||
    message.includes('block height exceeded') ||
    message.includes('Blockhash not found') ||
    message.includes('was not confirmed') ||
    message.includes('fetch failed') ||
    message.includes('Too Many Requests')
  );
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((wake) => setTimeout(wake, milliseconds));
}

export async function sendInstructions(
  cluster: Cluster,
  payer: KeyPairSigner,
  instructions: readonly Instruction[],
  options: SendOptions = {},
): Promise<string> {
  let lastFailure: unknown;
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
    try {
      return await sendOnce(cluster, payer, instructions, options);
    } catch (failure) {
      lastFailure = failure;
      if (!looksTemporary(failure)) {
        throw failure;
      }
      await pause(BACKOFF_MILLISECONDS * (attempt + 1));
    }
  }
  throw lastFailure;
}

export interface TransactionShape {
  readonly bytes: number;
  readonly uniqueAddresses: number;
  readonly computeUnits: bigint | null;
}

export async function measureTransaction(
  cluster: Cluster,
  payer: KeyPairSigner,
  instructions: readonly Instruction[],
  options: SendOptions = {},
): Promise<TransactionShape> {
  const { value: latestBlockhash } = await cluster.rpc.getLatestBlockhash().send();
  const signed = await signTransactionMessageWithSigners(
    buildTheMessage(payer, latestBlockhash, instructions, options),
  );
  const wire = getBase64EncodedWireTransaction(signed);
  const simulation = await cluster.rpc
    .simulateTransaction(wire, {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
    })
    .send();

  const compiled = compileTransactionMessage(
    buildTheMessage(payer, latestBlockhash, instructions, options),
  );
  return {
    bytes: Buffer.from(wire, 'base64').length,
    uniqueAddresses: compiled.staticAccounts.length,
    computeUnits: simulation.value.unitsConsumed ?? null,
  };
}

function buildTheMessage(
  payer: KeyPairSigner,
  latestBlockhash: Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0],
  instructions: readonly Instruction[],
  options: SendOptions,
) {
  return pipe(
    createTransactionMessage({ version: 1 }),
    (draft) => setTransactionMessageFeePayerSigner(payer, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, draft),
    (draft) =>
      setTransactionMessageComputeUnitLimit(
        options.computeUnitLimit ?? DEFAULT_COMPUTE_UNIT_LIMIT,
        draft,
      ),
    (draft) =>
      setTransactionMessagePriorityFeeLamports(DEFAULT_PRIORITY_FEE_LAMPORTS, draft),
    (draft) =>
      setTransactionMessageLoadedAccountsDataSizeLimit(
        LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
        draft,
      ),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
    (draft) => addSignersToTransactionMessage([...(options.extraSigners ?? [])], draft),
  );
}

async function sendOnce(
  cluster: Cluster,
  payer: KeyPairSigner,
  instructions: readonly Instruction[],
  options: SendOptions,
): Promise<string> {
  const { value: latestBlockhash } = await cluster.rpc.getLatestBlockhash().send();
  const message = buildTheMessage(payer, latestBlockhash, instructions, options);

  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendTransactionWithoutConfirmingFactory({ rpc: cluster.rpc })(signed, {
    commitment: 'confirmed',
  });
  const signature = getSignatureFromTransaction(signed);
  await waitForTheSignature(cluster, signature);
  return signature;
}

async function waitForTheSignature(cluster: Cluster, signature: string): Promise<void> {
  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    await pause(CONFIRMATION_POLL_MILLISECONDS);
    const { value } = await cluster.rpc
      .getSignatureStatuses([signature as Signature])
      .send();
    const status = value[0];
    if (status === null || status === undefined) {
      continue;
    }
    if (status.err !== null) {
      throw new Error(`${signature} failed on chain: ${JSON.stringify(status.err)}`);
    }
    if (
      status.confirmationStatus === 'confirmed' ||
      status.confirmationStatus === 'finalized'
    ) {
      return;
    }
  }
  throw new Error(`${signature} was not confirmed in time`);
}

export async function accountOwner(
  cluster: Cluster,
  value: Address,
): Promise<Address | null> {
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
    try {
      const { value: account } = await cluster.rpc
        .getAccountInfo(value, { encoding: 'base64' })
        .send();
      return account === null ? null : account.owner;
    } catch (failure) {
      if (!looksTemporary(failure)) {
        throw failure;
      }
      await pause(BACKOFF_MILLISECONDS * (attempt + 1));
    }
  }
  throw new Error(`devnet would not say who owns ${value}`);
}

export async function accountExists(cluster: Cluster, value: Address): Promise<boolean> {
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
    try {
      const { value: account } = await cluster.rpc
        .getAccountInfo(value, { encoding: 'base64' })
        .send();
      return account !== null;
    } catch (failure) {
      if (!looksTemporary(failure)) {
        throw failure;
      }
      await pause(BACKOFF_MILLISECONDS * (attempt + 1));
    }
  }
  throw new Error(`devnet would not say whether ${value} exists`);
}

export async function accountData(
  cluster: Cluster,
  value: Address,
): Promise<Uint8Array | null> {
  const { value: account } = await cluster.rpc
    .getAccountInfo(value, { encoding: 'base64' })
    .send();
  if (account === null) {
    return null;
  }
  return Uint8Array.from(Buffer.from(account.data[0], 'base64'));
}

export function reportStep(line: string): void {
  console.log(line);
}

export function reportSignature(what: string, signature: string): void {
  console.log(`  ${what}  ${signature}`);
  console.log(`    ${explorerLink(signature)}`);
}

// What a long running service writes: the same line with nothing in it to look a wallet up by.
export function reportServiceSignature(what: string, signature: string): void {
  console.log(`  ${what}  ${shortenAddress(signature)}`);
}
