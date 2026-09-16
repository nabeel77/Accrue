import { describe, expect, it } from 'vitest';

import {
  borrowToReachTarget,
  performanceFeeOnRealisedProfit,
  protectAmounts,
  repayToReachTarget,
} from './guard.js';
import { SCALED_FRACTION_ONE, wholeUnitsToScaledFraction } from './money.js';

const NVDAX_TARGET_BPS = 4_000;
const KEEPER_BOUNTY_BPS = 10;
const NO_BORROW_WEIGHTING = 100;

describe('what the guard repays', () => {
  it('follows the worked example from the program document', () => {
    const amounts = protectAmounts(
      wholeUnitsToScaledFraction(400n),
      wholeUnitsToScaledFraction(750n),
      NVDAX_TARGET_BPS,
      KEEPER_BOUNTY_BPS,
      NO_BORROW_WEIGHTING,
    );

    expect(amounts.repayUsdScaled).toBe(wholeUnitsToScaledFraction(100n));
    expect(amounts.bountyUsdScaled).toBe(SCALED_FRACTION_ONE / 10n);
  });

  it('asks a position already at its target for nothing', () => {
    const amounts = protectAmounts(
      wholeUnitsToScaledFraction(300n),
      wholeUnitsToScaledFraction(750n),
      NVDAX_TARGET_BPS,
      KEEPER_BOUNTY_BPS,
      NO_BORROW_WEIGHTING,
    );

    expect(amounts.repayUsdScaled).toBe(0n);
    expect(amounts.bountyUsdScaled).toBe(0n);
  });

  it('asks a healthy position for nothing', () => {
    expect(
      repayToReachTarget(
        wholeUnitsToScaledFraction(100n),
        wholeUnitsToScaledFraction(750n),
        NVDAX_TARGET_BPS,
        NO_BORROW_WEIGHTING,
      ),
    ).toBe(0n);
  });
});

describe('what the guard borrows back', () => {
  it('borrows the room between the debt and the target', () => {
    expect(
      borrowToReachTarget(
        wholeUnitsToScaledFraction(200n),
        wholeUnitsToScaledFraction(1_000n),
        NVDAX_TARGET_BPS,
        NO_BORROW_WEIGHTING,
      ),
    ).toBe(wholeUnitsToScaledFraction(200n));
  });

  it('borrows nothing when the position is already past its target', () => {
    expect(
      borrowToReachTarget(
        wholeUnitsToScaledFraction(500n),
        wholeUnitsToScaledFraction(1_000n),
        NVDAX_TARGET_BPS,
        NO_BORROW_WEIGHTING,
      ),
    ).toBe(0n);
  });
});

describe('the borrow factor the market weights debt by', () => {
  const A_FIFTH_MORE = 120;

  it('turns weighted value back into real USDC when the guard repays', () => {
    const deposited = wholeUnitsToScaledFraction(750n);
    const adjustedDebt = wholeUnitsToScaledFraction(400n);
    const amounts = protectAmounts(
      adjustedDebt,
      deposited,
      NVDAX_TARGET_BPS,
      KEEPER_BOUNTY_BPS,
      A_FIFTH_MORE,
    );

    const gap = wholeUnitsToScaledFraction(100n) * 100n;
    expect(amounts.repayUsdScaled).toBe(gap / 120n + (gap % 120n === 0n ? 0n : 1n));

    const repaidWeighted = (amounts.repayUsdScaled * 120n) / 100n;
    expect(adjustedDebt - repaidWeighted).toBeLessThanOrEqual(
      (deposited * BigInt(NVDAX_TARGET_BPS)) / 10_000n,
    );
  });

  it('lets grow borrow less than the room it sees', () => {
    const deposited = wholeUnitsToScaledFraction(1_000n);
    const adjustedDebt = wholeUnitsToScaledFraction(200n);

    expect(
      borrowToReachTarget(adjustedDebt, deposited, NVDAX_TARGET_BPS, A_FIFTH_MORE),
    ).toBe((wholeUnitsToScaledFraction(200n) * 100n) / 120n);
    expect(
      borrowToReachTarget(adjustedDebt, deposited, NVDAX_TARGET_BPS, A_FIFTH_MORE),
    ).toBeLessThan(
      borrowToReachTarget(adjustedDebt, deposited, NVDAX_TARGET_BPS, NO_BORROW_WEIGHTING),
    );
  });

  it('refuses a factor of zero rather than dividing by it', () => {
    expect(() =>
      repayToReachTarget(
        wholeUnitsToScaledFraction(400n),
        wholeUnitsToScaledFraction(750n),
        NVDAX_TARGET_BPS,
        0,
      ),
    ).toThrow();
  });
});

describe('the fee the owner is charged at unwind', () => {
  const USDC = 1_000_000n;
  const TEN_PERCENT_BPS = 1_000;

  it('is charged on what the sales raised above everything repaid', () => {
    expect(
      performanceFeeOnRealisedProfit(
        104n * USDC,
        50n * USDC + 51n * USDC,
        TEN_PERCENT_BPS,
      ),
    ).toBe(300_000n);
  });

  it('ignores principal the owner repaid from their own wallet', () => {
    const sales = 104n * USDC;
    const repaidInsideUnwind = 51n * USDC;
    const chargedOnTheWholeSale = performanceFeeOnRealisedProfit(
      sales,
      repaidInsideUnwind,
      TEN_PERCENT_BPS,
    );
    const chargedOnTheProfit = performanceFeeOnRealisedProfit(
      sales,
      50n * USDC + repaidInsideUnwind,
      TEN_PERCENT_BPS,
    );

    expect(chargedOnTheWholeSale).toBe(5_300_000n);
    expect(chargedOnTheProfit).toBe(300_000n);
    expect(chargedOnTheProfit).toBeLessThan(chargedOnTheWholeSale);
  });

  it('charges nothing when the position sold for less than it repaid', () => {
    expect(performanceFeeOnRealisedProfit(90n * USDC, 101n * USDC, TEN_PERCENT_BPS)).toBe(
      0n,
    );
    expect(
      performanceFeeOnRealisedProfit(101n * USDC, 101n * USDC, TEN_PERCENT_BPS),
    ).toBe(0n);
  });
});
