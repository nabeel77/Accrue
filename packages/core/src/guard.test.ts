import { describe, expect, it } from 'vitest';

import { borrowToReachTarget, protectAmounts, repayToReachTarget } from './guard.js';
import { SCALED_FRACTION_ONE, wholeUnitsToScaledFraction } from './money.js';

const NVDAX_TARGET_BPS = 4_000;
const KEEPER_BOUNTY_BPS = 10;

describe('what the guard repays', () => {
  it('follows the worked example from the program document', () => {
    const amounts = protectAmounts(
      wholeUnitsToScaledFraction(400n),
      wholeUnitsToScaledFraction(750n),
      NVDAX_TARGET_BPS,
      KEEPER_BOUNTY_BPS,
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
      ),
    ).toBe(wholeUnitsToScaledFraction(200n));
  });

  it('borrows nothing when the position is already past its target', () => {
    expect(
      borrowToReachTarget(
        wholeUnitsToScaledFraction(500n),
        wholeUnitsToScaledFraction(1_000n),
        NVDAX_TARGET_BPS,
      ),
    ).toBe(0n);
  });
});
