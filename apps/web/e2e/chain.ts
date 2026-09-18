import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { address, createSolanaRpc, type Base58EncodedBytes } from '@solana/kit';

import { getPositionDecoder, type Position } from '@accrue/solana/program';

const here = resolve(new URL('.', import.meta.url).pathname);

function endpoint(): string {
  const fromEnvironment = process.env['HELIUS_RPC_URL'];
  if (fromEnvironment !== undefined && fromEnvironment !== '') {
    return fromEnvironment;
  }
  const line = readFileSync(resolve(here, '../../../.env'), 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('HELIUS_RPC_URL='));
  return (line ?? '').slice('HELIUS_RPC_URL='.length).trim();
}

// The harness reads the chain itself so an assertion never depends on what the app reports.
export async function positionOnTheChain(owner: string): Promise<Position | null> {
  const rpc = createSolanaRpc(endpoint());
  const found = await rpc
    .getProgramAccounts(address('6KUwCyECUrvjppwAe92FxTqHLvw2LKGmfkV7j37r6gBb'), {
      encoding: 'base64',
      commitment: 'confirmed',
      filters: [
        {
          memcmp: {
            offset: 8n,
            bytes: owner as unknown as Base58EncodedBytes,
            encoding: 'base58',
          },
        },
      ],
    })
    .send();
  const first = found[0];
  return first === undefined
    ? null
    : getPositionDecoder().decode(
        Uint8Array.from(Buffer.from(first.account.data[0], 'base64')),
      );
}
