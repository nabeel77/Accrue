// A quote is only worth signing against for as long as a blockhash lives, so both die together.
export const QUOTE_LIFETIME_SECONDS = 60;

const A_SECOND_IN_MILLISECONDS = 1_000;

export function quoteAgeSeconds(
  quotedAtMilliseconds: number,
  nowMilliseconds: number,
): number {
  const age = Math.floor(
    (nowMilliseconds - quotedAtMilliseconds) / A_SECOND_IN_MILLISECONDS,
  );
  return age < 0 ? 0 : age;
}

export function theQuoteIsStale(
  quotedAtMilliseconds: number,
  nowMilliseconds: number,
): boolean {
  return quoteAgeSeconds(quotedAtMilliseconds, nowMilliseconds) > QUOTE_LIFETIME_SECONDS;
}

// The program refuses a price older than its config allows, so the app refuses the same one.
export function thePriceIsTooOld(ageInSlots: bigint, maxPriceAgeSlots: bigint): boolean {
  return maxPriceAgeSlots > 0n && ageInSlots > maxPriceAgeSlots;
}
