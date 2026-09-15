import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { address, createSolanaRpc, type Address } from '@solana/kit';

import { MAINNET_ACCOUNTS_TO_CAPTURE } from './mainnetAccounts.js';

const PUBLIC_MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';
const ACCOUNTS_PER_REQUEST = 100;

const repositoryRoot = resolve(import.meta.dirname, '../..');
const fixturesDirectory = resolve(repositoryRoot, 'tests/fixtures');
const accountsDirectory = resolve(fixturesDirectory, 'accounts');

interface CapturedAccount {
  label: string;
  description: string;
  address: string;
  owner: string;
  /** A string because lamports can exceed what a JSON number holds exactly. */
  lamports: string;
  executable: boolean;
  data_base64: string;
}

function resolveRpcUrl(): string {
  const fromEnvironment = process.env['HELIUS_RPC_URL'] ?? process.env['KEEPER_RPC_URL'];
  if (fromEnvironment) {
    return fromEnvironment;
  }
  console.warn(
    'No HELIUS_RPC_URL set, falling back to the public endpoint. It is rate limited.',
  );
  return PUBLIC_MAINNET_RPC_URL;
}

function chunk<Item>(items: readonly Item[], size: number): Item[][] {
  const chunks: Item[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

async function captureMainnetAccounts(): Promise<void> {
  const rpc = createSolanaRpc(resolveRpcUrl());

  const addresses: Address[] = MAINNET_ACCOUNTS_TO_CAPTURE.map((entry) =>
    address(entry.address),
  );

  const captured: CapturedAccount[] = [];
  let contextSlot = 0n;

  for (const batch of chunk(addresses, ACCOUNTS_PER_REQUEST)) {
    const response = await rpc.getMultipleAccounts(batch, { encoding: 'base64' }).send();
    contextSlot = response.context.slot;

    response.value.forEach((account, indexInBatch) => {
      const capturedAddress = batch[indexInBatch];
      const entry = MAINNET_ACCOUNTS_TO_CAPTURE.find(
        (candidate) => candidate.address === capturedAddress,
      );
      if (entry === undefined) {
        throw new Error(`Unexpected address in response at position ${indexInBatch}`);
      }
      if (account === null) {
        throw new Error(`${entry.label} (${entry.address}) does not exist on mainnet.`);
      }
      captured.push({
        label: entry.label,
        description: entry.description,
        address: entry.address,
        owner: account.owner,
        lamports: String(account.lamports),
        executable: account.executable,
        data_base64: account.data[0],
      });
    });
  }

  const blockTime = await rpc
    .getBlockTime(contextSlot)
    .send()
    .catch(() => null);

  rmSync(accountsDirectory, { recursive: true, force: true });
  mkdirSync(accountsDirectory, { recursive: true });

  for (const account of captured) {
    writeFileSync(
      resolve(accountsDirectory, `${account.label}.json`),
      `${JSON.stringify(account, null, 2)}\n`,
    );
  }

  writeFileSync(
    resolve(fixturesDirectory, 'snapshot.json'),
    `${JSON.stringify(
      {
        cluster: 'mainnet-beta',
        slot: Number(contextSlot),
        unix_timestamp:
          blockTime === null ? Math.floor(Date.now() / 1000) : Number(blockTime),
        captured_at: new Date().toISOString(),
        account_count: captured.length,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Captured ${captured.length} mainnet accounts at slot ${contextSlot}.`);
}

await captureMainnetAccounts();
