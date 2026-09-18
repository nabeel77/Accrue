import 'server-only';

import { type Address, type Base58EncodedBytes } from '@solana/kit';

import { getPositionDecoder, type Position } from '@accrue/solana/program';

import { accrueProgramAddress } from '../programAddress.js';
import { chain } from '../rpc.js';

const POSITION_OWNER_OFFSET = 8n;

export interface PositionOnChain {
  readonly address: Address;
  readonly account: Position;
}

export async function positionsOwnedOnChain(owner: Address): Promise<PositionOnChain[]> {
  const accounts = await chain()
    .rpc.getProgramAccounts(accrueProgramAddress(), {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: POSITION_OWNER_OFFSET,
            bytes: owner as unknown as Base58EncodedBytes,
            encoding: 'base58',
          },
        },
      ],
    })
    .send();

  const found: PositionOnChain[] = [];
  for (const entry of accounts) {
    try {
      found.push({
        address: entry.pubkey,
        account: getPositionDecoder().decode(
          Uint8Array.from(Buffer.from(entry.account.data[0], 'base64')),
        ),
      });
    } catch {
      continue;
    }
  }
  return found;
}
