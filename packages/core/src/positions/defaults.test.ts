import { describe, expect, it } from 'vitest';

import { defaultStrategyFor, netYieldBps } from './defaults.js';
import { MIN_GUARD_ROOM_BPS_FOR_TESTS } from './defaults.test.helpers.js';

describe("Accrue's default strategy for a stock", () => {
  it('gives NVDAx the numbers every example in the docs uses', () => {
    // A 55 percent maximum: target 40, guard 50, grow below 30.
    expect(defaultStrategyFor(5_500)).toEqual({
      targetLtvBps: 4_000,
      protectLtvBps: 5_000,
      growBelowLtvBps: 3_000,
      growEnabled: false,
    });
  });

  it('derives every stock from its own maximum', () => {
    expect(defaultStrategyFor(7_300).targetLtvBps).toBe(5_000);
    expect(defaultStrategyFor(3_000)).toEqual({
      targetLtvBps: 2_000,
      protectLtvBps: 2_500,
      growBelowLtvBps: 1_000,
      growEnabled: false,
    });
  });

  it('never borrows more on a rising stock unless the owner asks for it', () => {
    for (const maximumBps of [3_000, 5_500, 7_300]) {
      expect(defaultStrategyFor(maximumBps).growEnabled).toBe(false);
    }
  });

  it('stays inside the bounds the program checks', () => {
    for (const maximumBps of [3_000, 3_500, 4_000, 5_500, 6_000, 7_000, 7_300]) {
      const strategy = defaultStrategyFor(maximumBps);
      const liquidationThresholdBps = maximumBps + 1_000;
      expect(strategy.protectLtvBps).toBeLessThanOrEqual(
        liquidationThresholdBps - MIN_GUARD_ROOM_BPS_FOR_TESTS,
      );
      expect(strategy.targetLtvBps).toBeLessThanOrEqual(
        strategy.protectLtvBps - MIN_GUARD_ROOM_BPS_FOR_TESTS,
      );
      expect(strategy.targetLtvBps).toBeLessThanOrEqual(maximumBps);
      expect(strategy.targetLtvBps).toBeGreaterThan(0);
      expect(strategy.growBelowLtvBps).toBeLessThan(strategy.targetLtvBps);
    }
  });

  it('shows the net yield the stock list shows', () => {
    // NVDAx at 40 percent, ONyc targeting 11.54, USDC costing 5.05: 0.40 times 6.49 is 2.60.
    expect(netYieldBps(4_000, 1_154, 505)).toBe(260);
  });

  it('shows a negative net yield rather than hiding it', () => {
    expect(netYieldBps(4_000, 300, 505)).toBe(-82);
  });
});
