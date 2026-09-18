import { describe, expect, it } from 'vitest';

import { loanToValueBps } from '../guard.js';
import {
  adjustedDebtValueScaled,
  MIN_GUARD_ROOM_BPS,
  whyTheStrategyIsRefused,
} from './strategy.js';

const NVDAX_MAX = 5_500;
const NVDAX_THRESHOLD = 6_000;

describe('the bounds the program enforces', () => {
  it('accepts the default for a stock', () => {
    expect(
      whyTheStrategyIsRefused(
        { targetLtvBps: 4_000, protectLtvBps: 5_000, growBelowLtvBps: 3_000 },
        NVDAX_MAX,
        NVDAX_THRESHOLD,
      ),
    ).toBeNull();
  });

  it('refuses a guard level inside five points of liquidation', () => {
    expect(
      whyTheStrategyIsRefused(
        {
          targetLtvBps: 4_000,
          protectLtvBps: NVDAX_THRESHOLD - 400,
          growBelowLtvBps: 3_000,
        },
        NVDAX_MAX,
        NVDAX_THRESHOLD,
      ),
    ).toBe('protectLevelTooHigh');
  });

  it('accepts a guard level exactly five points under liquidation', () => {
    expect(
      whyTheStrategyIsRefused(
        {
          targetLtvBps: NVDAX_THRESHOLD - 2 * MIN_GUARD_ROOM_BPS,
          protectLtvBps: NVDAX_THRESHOLD - MIN_GUARD_ROOM_BPS,
          growBelowLtvBps: 3_000,
        },
        NVDAX_MAX,
        NVDAX_THRESHOLD,
      ),
    ).toBeNull();
  });

  it('refuses a borrow level inside five points of the guard', () => {
    expect(
      whyTheStrategyIsRefused(
        { targetLtvBps: 4_700, protectLtvBps: 5_000, growBelowLtvBps: 3_000 },
        NVDAX_MAX,
        NVDAX_THRESHOLD,
      ),
    ).toBe('targetLevelTooHigh');
  });

  it('refuses a borrow level over what the market allows', () => {
    expect(
      whyTheStrategyIsRefused(
        { targetLtvBps: 5_400, protectLtvBps: 5_900, growBelowLtvBps: 3_000 },
        5_000,
        NVDAX_THRESHOLD + 400,
      ),
    ).toBe('targetLevelTooHigh');
  });

  it('refuses a borrow level of nothing', () => {
    expect(
      whyTheStrategyIsRefused(
        { targetLtvBps: 0, protectLtvBps: 5_000, growBelowLtvBps: 0 },
        NVDAX_MAX,
        NVDAX_THRESHOLD,
      ),
    ).toBe('targetLevelTooLow');
  });

  it('refuses a grow level at or over the borrow level', () => {
    expect(
      whyTheStrategyIsRefused(
        { targetLtvBps: 4_000, protectLtvBps: 5_000, growBelowLtvBps: 4_000 },
        NVDAX_MAX,
        NVDAX_THRESHOLD,
      ),
    ).toBe('growLevelTooHigh');
  });

  it('refuses a market whose threshold leaves no room for a guard', () => {
    expect(
      whyTheStrategyIsRefused(
        { targetLtvBps: 100, protectLtvBps: 200, growBelowLtvBps: 50 },
        400,
        400,
      ),
    ).toBe('reserveLeavesNoGuardRoom');
  });
});

describe('loan to value with the borrow factor', () => {
  const ONE = 1n << 60n;

  it('weights the debt before the market compares it with the collateral', () => {
    expect(loanToValueBps(adjustedDebtValueScaled(40n * ONE, 100), 100n * ONE)).toBe(
      4_000,
    );
    expect(loanToValueBps(adjustedDebtValueScaled(40n * ONE, 150), 100n * ONE)).toBe(
      6_000,
    );
  });

  it('reads nothing as nothing rather than dividing by it', () => {
    expect(loanToValueBps(adjustedDebtValueScaled(40n * ONE, 100), 0n)).toBe(0);
  });
});
