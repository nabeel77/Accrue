const MINT_DECIMALS = 44;
const MINT_BASE_LENGTH = 82;

const TOKEN_ACCOUNT_AMOUNT = 64;
const TOKEN_ACCOUNT_BASE_LENGTH = 165;

export function unsignedAt(data: Uint8Array, offset: number, byteLength: number): bigint {
  let value = 0n;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return value;
}

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

const MINT_EXTENSIONS_START = 165;
const EXTENSION_HEADER_LENGTH = 4;
const SCALED_UI_AMOUNT_EXTENSION = 43;

function doubleAt(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getFloat64(0, true);
}

export function decodeScaledUiAmountMultiplier(data: Uint8Array): number {
  let at = MINT_EXTENSIONS_START + 1;
  while (at + EXTENSION_HEADER_LENGTH <= data.length) {
    const kind = (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
    const length = (data[at + 2] ?? 0) | ((data[at + 3] ?? 0) << 8);
    const body = at + EXTENSION_HEADER_LENGTH;
    if (kind === SCALED_UI_AMOUNT_EXTENSION && body + 40 <= data.length) {
      const newMultiplierEffectiveTimestamp = Number(unsignedAt(data, body + 32, 8));
      const nowInSeconds = Math.floor(Date.now() / 1_000);
      return nowInSeconds >= newMultiplierEffectiveTimestamp
        ? doubleAt(data, body + 40)
        : doubleAt(data, body + 24);
    }
    if (length === 0) {
      break;
    }
    at = body + length;
  }
  return 1;
}
