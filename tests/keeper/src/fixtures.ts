import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { address, type Address } from '@solana/kit';

export const repositoryRoot = resolve(import.meta.dirname, '../../..');
export const fixturesDirectory = resolve(repositoryRoot, 'tests/fixtures');

export interface CapturedAccount {
  readonly label: string;
  readonly address: string;
  readonly owner: string;
  readonly lamports: string;
  readonly executable: boolean;
  readonly data_base64: string;
}

export interface MainnetSnapshot {
  readonly slot: bigint;
  readonly unixTimestamp: bigint;
  readonly accounts: readonly CapturedAccount[];
}

/** The same snapshot the program's own suite loads: real accounts at one real slot. */
export function loadMainnetSnapshot(): MainnetSnapshot {
  const manifest = JSON.parse(
    readFileSync(resolve(fixturesDirectory, 'snapshot.json'), 'utf8'),
  ) as { slot: number; unix_timestamp: number };

  const directory = resolve(fixturesDirectory, 'accounts');
  const accounts = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map(
      (name) =>
        JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as CapturedAccount,
    );

  if (accounts.length === 0) {
    throw new Error('no fixture accounts. Run `pnpm fixtures:refresh` first.');
  }

  return {
    slot: BigInt(manifest.slot),
    unixTimestamp: BigInt(manifest.unix_timestamp),
    accounts,
  };
}

export function capturedAccount(
  snapshot: MainnetSnapshot,
  label: string,
): CapturedAccount {
  const found = snapshot.accounts.find((account) => account.label === label);
  if (found === undefined) {
    throw new Error(`no fixture account labelled ${label}`);
  }
  return found;
}

export function capturedAddress(snapshot: MainnetSnapshot, label: string): Address {
  return address(capturedAccount(snapshot, label).address);
}

export function capturedData(snapshot: MainnetSnapshot, label: string): Uint8Array {
  return new Uint8Array(
    Buffer.from(capturedAccount(snapshot, label).data_base64, 'base64'),
  );
}
