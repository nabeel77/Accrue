const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function encodeBase58(raw: Uint8Array): string {
  let value = 0n;
  for (const byte of raw) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = '';
  while (value > 0n) {
    const digit = BASE58_ALPHABET.charAt(Number(value % 58n));
    encoded = digit + encoded;
    value /= 58n;
  }

  let leadingZeros = 0;
  for (const byte of raw) {
    if (byte !== 0) break;
    leadingZeros += 1;
  }

  return '1'.repeat(leadingZeros) + encoded;
}
