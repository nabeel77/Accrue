import { getAddressEncoder, type Address } from '@solana/kit';

import { TOKEN_2022_PROGRAM_ADDRESS } from '@accrue/solana';

const TOKEN_ACCOUNT_BASE_LENGTH = 165;
const TOKEN_ACCOUNT_STATE = 108;
const TOKEN_ACCOUNT_INITIALIZED = 1;
const TOKEN_2022_ACCOUNT_DISCRIMINATOR = 2;
const IMMUTABLE_OWNER_EXTENSION = 7;
const MINT_ACCOUNT_LENGTH = 82;

const addresses = getAddressEncoder();

function writeAddress(data: Uint8Array, offset: number, value: Address): void {
  data.set(new Uint8Array(addresses.encode(value)), offset);
}

function writeUnsigned(
  data: Uint8Array,
  offset: number,
  value: bigint,
  byteLength: number,
): void {
  let remaining = value;
  for (let index = 0; index < byteLength; index += 1) {
    data[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

/** A token account as either token program lays it out, with the extension header 2022 expects. */
export function tokenAccountData(input: {
  readonly mint: Address;
  readonly owner: Address;
  readonly amount: bigint;
  readonly tokenProgram: Address;
}): Uint8Array {
  const isToken2022 = input.tokenProgram === TOKEN_2022_PROGRAM_ADDRESS;
  const data = new Uint8Array(TOKEN_ACCOUNT_BASE_LENGTH + (isToken2022 ? 5 : 0));

  writeAddress(data, 0, input.mint);
  writeAddress(data, 32, input.owner);
  writeUnsigned(data, 64, input.amount, 8);
  data[TOKEN_ACCOUNT_STATE] = TOKEN_ACCOUNT_INITIALIZED;

  if (isToken2022) {
    data[TOKEN_ACCOUNT_BASE_LENGTH] = TOKEN_2022_ACCOUNT_DISCRIMINATOR;
    writeUnsigned(
      data,
      TOKEN_ACCOUNT_BASE_LENGTH + 1,
      BigInt(IMMUTABLE_OWNER_EXTENSION),
      2,
    );
    writeUnsigned(data, TOKEN_ACCOUNT_BASE_LENGTH + 3, 0n, 2);
  }
  return data;
}

export function mintAccountData(input: {
  readonly mintAuthority: Address;
  readonly supply: bigint;
  readonly decimals: number;
}): Uint8Array {
  const data = new Uint8Array(MINT_ACCOUNT_LENGTH);
  writeUnsigned(data, 0, 1n, 4);
  writeAddress(data, 4, input.mintAuthority);
  writeUnsigned(data, 36, input.supply, 8);
  data[44] = input.decimals;
  data[45] = 1;
  return data;
}
