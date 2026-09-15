import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { address, createSolanaRpc } from '@solana/kit';

import { encodeBase58 } from '../shared/base58.js';
import { MAINNET_PROGRAMS_TO_DOWNLOAD } from './mainnetAccounts.js';

const PUBLIC_MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';
const UPGRADEABLE_LOADER_PROGRAMDATA_HEADER_LEN = 45;
const PROGRAM_ACCOUNT_PROGRAMDATA_OFFSET = 4;

const repositoryRoot = resolve(import.meta.dirname, '../..');
const programsDirectory = resolve(repositoryRoot, 'tests/fixtures/programs');

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

async function downloadPrograms(): Promise<void> {
  const rpc = createSolanaRpc(resolveRpcUrl());
  mkdirSync(programsDirectory, { recursive: true });

  for (const entry of MAINNET_PROGRAMS_TO_DOWNLOAD) {
    const programAccount = await rpc
      .getAccountInfo(address(entry.programAddress), { encoding: 'base64' })
      .send();
    if (programAccount.value === null) {
      throw new Error(
        `${entry.label} (${entry.programAddress}) does not exist on mainnet.`,
      );
    }

    const programAccountBytes = Buffer.from(programAccount.value.data[0], 'base64');
    const programDataAddress = encodeBase58(
      programAccountBytes.subarray(
        PROGRAM_ACCOUNT_PROGRAMDATA_OFFSET,
        PROGRAM_ACCOUNT_PROGRAMDATA_OFFSET + 32,
      ),
    );

    const programDataAccount = await rpc
      .getAccountInfo(address(programDataAddress), { encoding: 'base64' })
      .send();
    if (programDataAccount.value === null) {
      throw new Error(
        `${entry.label} has no program data account at ${programDataAddress}`,
      );
    }

    const executable = Buffer.from(programDataAccount.value.data[0], 'base64').subarray(
      UPGRADEABLE_LOADER_PROGRAMDATA_HEADER_LEN,
    );

    const outputPath = resolve(programsDirectory, `${entry.label}.so`);
    writeFileSync(outputPath, executable);
    console.log(
      `${entry.label}: ${executable.length} bytes from ${programDataAddress} into ${outputPath}`,
    );
  }
}

await downloadPrograms();
