import { describe, expect, it } from 'vitest';

import { address } from '@solana/kit';

import {
  hasCrossedItsGuardLevel,
  loanToValueAtANewPrice,
  type PriceSensitivePosition,
} from './priceWatch.js';

const A_DOLLAR = 2n ** 60n;

function watched(
  overrides: Partial<PriceSensitivePosition> = {},
): PriceSensitivePosition {
  return {
    scopePriceAccount: address('C88HB7ajhR6ZrAawBwt9FV2yFnvQWTYy6Atg6pFSPX9j'),
    scopeFeedIndex: 350,
    collateralPriceScaled: A_DOLLAR * 100n,
    loanToValueBps: 4_000,
    protectLtvBps: 5_000,
    ...overrides,
  };
}

describe('loanToValueAtANewPrice', () => {
  it('leaves the ratio alone when the price has not moved', () => {
    expect(loanToValueAtANewPrice(watched(), A_DOLLAR * 100n)).toBe(4_000);
  });

  it('raises the ratio when the collateral price falls', () => {
    expect(loanToValueAtANewPrice(watched(), A_DOLLAR * 80n)).toBe(5_000);
  });

  it('lowers the ratio when the collateral price rises', () => {
    expect(loanToValueAtANewPrice(watched(), A_DOLLAR * 200n)).toBe(2_000);
  });

  it('keeps the last ratio rather than dividing by a price of nothing', () => {
    expect(loanToValueAtANewPrice(watched(), 0n)).toBe(4_000);
  });
});

describe('hasCrossedItsGuardLevel', () => {
  it('is false while the fall leaves it under the guard level', () => {
    expect(hasCrossedItsGuardLevel(watched(), A_DOLLAR * 90n)).toBe(false);
  });

  it('is true the moment the fall takes it to the guard level', () => {
    expect(hasCrossedItsGuardLevel(watched(), A_DOLLAR * 80n)).toBe(true);
  });

  it('is true once the fall takes it past the guard level', () => {
    expect(hasCrossedItsGuardLevel(watched(), A_DOLLAR * 50n)).toBe(true);
  });

  it('is false for a position that was already above its guard level', () => {
    expect(
      hasCrossedItsGuardLevel(watched({ loanToValueBps: 5_200 }), A_DOLLAR * 90n),
    ).toBe(false);
  });

  it('is false when the price rises', () => {
    expect(hasCrossedItsGuardLevel(watched(), A_DOLLAR * 150n)).toBe(false);
  });
});
