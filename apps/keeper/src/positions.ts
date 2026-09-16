import {
  getBase58Decoder,
  type Address,
  type Base58EncodedBytes,
  type GetProgramAccountsApi,
  type Rpc,
} from '@solana/kit';

import {
  getPositionDecoder,
  POSITION_DISCRIMINATOR,
  PositionState,
  type Position,
} from '@accrue/solana/program';

/**
 * Where the state byte sits inside a Position account. Proved against the generated encoder in
 * `positions.test.ts`, so a change to the account layout fails a test rather than the filter.
 */
export const POSITION_STATE_OFFSET = 338n;

export interface WatchedPosition {
  readonly address: Address;
  readonly account: Position;
}

function asBase58(bytes: Uint8Array): Base58EncodedBytes {
  return getBase58Decoder().decode(bytes) as Base58EncodedBytes;
}

export async function loadOpenPositions(
  rpc: Rpc<GetProgramAccountsApi>,
  programAddress: Address,
): Promise<WatchedPosition[]> {
  const accounts = await rpc
    .getProgramAccounts(programAddress, {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: asBase58(POSITION_DISCRIMINATOR),
            encoding: 'base58',
          },
        },
        {
          memcmp: {
            offset: POSITION_STATE_OFFSET,
            bytes: asBase58(new Uint8Array([PositionState.Open])),
            encoding: 'base58',
          },
        },
      ],
    })
    .send();

  const decoder = getPositionDecoder();
  return accounts.map((entry) => ({
    address: entry.pubkey,
    account: decoder.decode(new Uint8Array(Buffer.from(entry.account.data[0], 'base64'))),
  }));
}
