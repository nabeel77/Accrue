const MINT_DECIMALS = 44;
const MINT_BASE_LENGTH = 82;

const TOKEN_ACCOUNT_AMOUNT = 64;
const TOKEN_ACCOUNT_BASE_LENGTH = 165;

function unsignedAt(data: Uint8Array, offset: number, byteLength: number): bigint {
  let value = 0n;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return value;
}

/**
 * Both token programs put the same fields at the same offsets and add their extensions after the
 * base account, so one reader serves a classic mint and a Token 2022 mint alike.
 */
export function decodeMintDecimals(data: Uint8Array): number {
  if (data.length < MINT_BASE_LENGTH) {
    throw new Error('that account is not long enough to be a mint');
  }
  return data[MINT_DECIMALS] ?? 0;
}

export function decodeTokenAccountAmount(data: Uint8Array): bigint {
  if (data.length < TOKEN_ACCOUNT_BASE_LENGTH) {
    throw new Error('that account is not long enough to be a token account');
  }
  return unsignedAt(data, TOKEN_ACCOUNT_AMOUNT, 8);
}
