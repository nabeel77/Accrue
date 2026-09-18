import { describe, expect, it } from 'vitest';

import {
  QUOTE_LIFETIME_SECONDS,
  quoteAgeSeconds,
  theQuoteIsStale,
  thePriceIsTooOld,
} from './freshness.js';

const NOW = 1_800_000_000_000;

describe('how old a quote is', () => {
  it('counts whole seconds since it was read', () => {
    expect(quoteAgeSeconds(NOW - 12_400, NOW)).toBe(12);
  });

  it('never reports a negative age when the clocks disagree', () => {
    expect(quoteAgeSeconds(NOW + 5_000, NOW)).toBe(0);
  });

  it('holds a quote until its lifetime is past, then refuses it', () => {
    const justInside = NOW - QUOTE_LIFETIME_SECONDS * 1_000;
    const justOutside = NOW - (QUOTE_LIFETIME_SECONDS + 1) * 1_000;
    expect(theQuoteIsStale(justInside, NOW)).toBe(false);
    expect(theQuoteIsStale(justOutside, NOW)).toBe(true);
  });
});

describe('how old a price may be', () => {
  it('refuses a price past the age the program allows', () => {
    expect(thePriceIsTooOld(150n, 150n)).toBe(false);
    expect(thePriceIsTooOld(151n, 150n)).toBe(true);
  });

  it('treats a limit of zero as no limit, which is what the program does', () => {
    expect(thePriceIsTooOld(10_000n, 0n)).toBe(false);
  });
});
