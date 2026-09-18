const KEPT_AT_EACH_END = 4;
const SHORTEST_ENCODED_KEY = 32;
// Base58 as Solana writes it: no zero, no capital O, no capital I, no lower case l.
const BASE58_RUN = new RegExp(`[1-9A-HJ-NP-Za-km-z]{${SHORTEST_ENCODED_KEY},}`, 'gu');

export function shortenAddress(value: string): string {
  if (value.length <= KEPT_AT_EACH_END * 2) {
    return value;
  }
  return `${value.slice(0, KEPT_AT_EACH_END)}…${value.slice(-KEPT_AT_EACH_END)}`;
}

const HAS_A_LETTER = /[A-HJ-NP-Za-km-z]/u;

// Anything long enough to be an address, a signature or a key is shortened before it is written.
// A run of digits alone is a raw amount, and those stay whole however long they are.
export function shortenEveryAddress(line: string): string {
  return line.replace(BASE58_RUN, (found) =>
    HAS_A_LETTER.test(found) ? shortenAddress(found) : found,
  );
}
