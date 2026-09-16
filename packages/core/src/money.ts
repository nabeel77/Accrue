export const BASIS_POINTS_DENOMINATOR = 10_000n;
export const PERCENT_DENOMINATOR = 100n;

/** The lending market keeps every value as a fraction scaled by two to the sixtieth. */
export const SCALED_FRACTION_BITS = 60n;
export const SCALED_FRACTION_ONE = 1n << SCALED_FRACTION_BITS;

const LARGEST_UNSIGNED_64 = (1n << 64n) - 1n;

function requireInRange(value: bigint, what: string): bigint {
  if (value < 0n || value > LARGEST_UNSIGNED_64) {
    throw new Error(`${what} does not fit in the amount the chain carries`);
  }
  return value;
}

function tenToThe(power: number): bigint {
  return 10n ** BigInt(power);
}

function divideRoundingUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('a price of zero cannot be divided by');
  }
  return numerator % denominator === 0n
    ? numerator / denominator
    : numerator / denominator + 1n;
}

export interface OraclePrice {
  readonly value: bigint;
  readonly exponent: bigint;
}

/** One whole token's worth in dollars, at the lending market's own scale. */
export function usdPerWholeTokenScaled(price: OraclePrice): bigint {
  if (price.value <= 0n) {
    throw new Error('the oracle reported a price of zero');
  }
  return (price.value * SCALED_FRACTION_ONE) / 10n ** price.exponent;
}

export function usdValueOfScaled(
  rawAmount: bigint,
  decimals: number,
  priceScaled: bigint,
): bigint {
  return (rawAmount * priceScaled) / tenToThe(decimals);
}

export function rawAmountWorthRoundingUp(
  usdValueScaled: bigint,
  decimals: number,
  priceScaled: bigint,
): bigint {
  return requireInRange(
    divideRoundingUp(usdValueScaled * tenToThe(decimals), priceScaled),
    'the amount the oracle price asks for',
  );
}

export function rawAmountWorthRoundingDown(
  usdValueScaled: bigint,
  decimals: number,
  priceScaled: bigint,
): bigint {
  if (priceScaled <= 0n) {
    throw new Error('a price of zero cannot be divided by');
  }
  return requireInRange(
    (usdValueScaled * tenToThe(decimals)) / priceScaled,
    'the amount the oracle price asks for',
  );
}

/** Sell a little more than the fair amount, so a fill inside the slippage still covers the repay. */
export function addTheSlippageBuffer(rawAmount: bigint, maxSlippageBps: number): bigint {
  const remainingBps = BASIS_POINTS_DENOMINATOR - BigInt(maxSlippageBps);
  if (remainingBps <= 0n) {
    throw new Error('the slippage allowance leaves nothing of the trade');
  }
  return requireInRange(
    divideRoundingUp(rawAmount * BASIS_POINTS_DENOMINATOR, remainingBps),
    'the amount the guard would sell',
  );
}

export interface SwapSide {
  readonly rawAmount: bigint;
  readonly decimals: number;
  readonly priceScaled: bigint;
}

/**
 * The floor the program puts under a permissionless swap. The keeper computes the same number so
 * it never asks the router for a fill the program is going to refuse.
 */
export function minimumOutputTheOracleAllows(
  selling: SwapSide,
  buyingDecimals: number,
  buyingPriceScaled: bigint,
  maxSlippageBps: number,
): bigint {
  const valueScaled = usdValueOfScaled(
    selling.rawAmount,
    selling.decimals,
    selling.priceScaled,
  );
  const fairOutput = rawAmountWorthRoundingDown(
    valueScaled,
    buyingDecimals,
    buyingPriceScaled,
  );
  const remainingBps = BASIS_POINTS_DENOMINATOR - BigInt(maxSlippageBps);
  if (remainingBps < 0n) {
    throw new Error('the slippage allowance leaves nothing of the trade');
  }
  return (fairOutput * remainingBps) / BASIS_POINTS_DENOMINATOR;
}

export function scaledFractionToWholeUnitsRoundingUp(scaled: bigint): bigint {
  return divideRoundingUp(scaled, SCALED_FRACTION_ONE);
}

export function wholeUnitsToScaledFraction(wholeUnits: bigint): bigint {
  return wholeUnits * SCALED_FRACTION_ONE;
}
