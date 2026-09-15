import { describe, expect, it } from 'vitest';

import {
  addTheSlippageBuffer,
  minimumOutputTheOracleAllows,
  rawAmountWorthRoundingDown,
  rawAmountWorthRoundingUp,
  scaledFractionToWholeUnitsRoundingUp,
  usdPerWholeTokenScaled,
  usdValueOfScaled,
  wholeUnitsToScaledFraction,
} from './money.js';

const USDC_DECIMALS = 6;
const DESTINATION_DECIMALS = 9;
const MAX_SLIPPAGE_BPS = 100;

const ONE_DOLLAR = usdPerWholeTokenScaled({ value: 100_000_000n, exponent: 8n });
const TWO_DOLLARS = usdPerWholeTokenScaled({ value: 200_000_000n, exponent: 8n });

describe('turning a price into an amount', () => {
  it('reads a dollar out of the oracle at the scale the market uses', () => {
    expect(ONE_DOLLAR).toBe(wholeUnitsToScaledFraction(1n));
  });

  it('refuses a price of zero rather than dividing by it', () => {
    expect(() => usdPerWholeTokenScaled({ value: 0n, exponent: 8n })).toThrow();
  });

  it('values a balance at the oracle price', () => {
    expect(usdValueOfScaled(1_000_000n, USDC_DECIMALS, ONE_DOLLAR)).toBe(
      wholeUnitsToScaledFraction(1n),
    );
    expect(usdValueOfScaled(1_000_000_000n, DESTINATION_DECIMALS, TWO_DOLLARS)).toBe(
      wholeUnitsToScaledFraction(2n),
    );
  });

  it('rounds the amount it has to raise up and the amount it will get down', () => {
    const awkward = wholeUnitsToScaledFraction(1n) + 1n;
    expect(rawAmountWorthRoundingUp(awkward, USDC_DECIMALS, ONE_DOLLAR)).toBe(1_000_001n);
    expect(rawAmountWorthRoundingDown(awkward, USDC_DECIMALS, ONE_DOLLAR)).toBe(
      1_000_000n,
    );
  });
});

describe('the room the guard leaves around a swap', () => {
  it('sells enough that a fill one percent worse still covers the repay', () => {
    expect(addTheSlippageBuffer(99_000_000n, MAX_SLIPPAGE_BPS)).toBe(100_000_000n);
  });

  it('refuses a slippage allowance that leaves nothing of the trade', () => {
    expect(() => addTheSlippageBuffer(1_000n, 10_000)).toThrow();
  });

  it('puts the floor one percent under what the oracle says the sale is worth', () => {
    const minimum = minimumOutputTheOracleAllows(
      {
        rawAmount: 1_000_000_000n,
        decimals: DESTINATION_DECIMALS,
        priceScaled: TWO_DOLLARS,
      },
      USDC_DECIMALS,
      ONE_DOLLAR,
      MAX_SLIPPAGE_BPS,
    );

    expect(minimum).toBe(1_980_000n);
  });
});

describe('the scaled fraction the market keeps its values in', () => {
  it('rounds a debt up to the whole unit a repay has to cover', () => {
    expect(scaledFractionToWholeUnitsRoundingUp(wholeUnitsToScaledFraction(5n))).toBe(5n);
    expect(
      scaledFractionToWholeUnitsRoundingUp(wholeUnitsToScaledFraction(5n) + 1n),
    ).toBe(6n);
  });
});
