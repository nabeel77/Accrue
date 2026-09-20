import { describe, expect, it } from 'vitest';

import { priceFallToReachBps, theGuardLine, theLiquidationLine } from './priceFall.js';

const PERCENT = 100;

function asPercent(bps: number): number {
  return Math.round(bps / PERCENT);
}

describe('how far the stock falls to reach a loan to value line', () => {
  it('reads SPYx at fifty, sixty eight and seventy five', () => {
    const guard = theGuardLine(5_000, 6_800);
    const liquidation = theLiquidationLine(5_000, 7_500);

    expect(asPercent(guard.fallBps)).toBe(26);
    expect(asPercent(guard.levelBps)).toBe(68);
    expect(asPercent(liquidation.fallBps)).toBe(33);
    expect(asPercent(liquidation.levelBps)).toBe(75);
  });

  it('reads NVDAx at forty, forty five and sixty five', () => {
    const guard = theGuardLine(4_000, 4_500);
    const liquidation = theLiquidationLine(4_000, 6_500);

    expect(asPercent(guard.fallBps)).toBe(11);
    expect(asPercent(guard.levelBps)).toBe(45);
    expect(asPercent(liquidation.fallBps)).toBe(38);
    expect(asPercent(liquidation.levelBps)).toBe(65);
  });

  it('is one minus the target over the line, to the basis point', () => {
    expect(priceFallToReachBps(5_000, 6_800)).toBe(2_647);
    expect(priceFallToReachBps(5_000, 7_500)).toBe(3_333);
    expect(priceFallToReachBps(4_000, 4_500)).toBe(1_111);
    expect(priceFallToReachBps(4_000, 6_500)).toBe(3_846);
  });

  // Rounding down says the stock can fall less far than it really can, which is the side of the
  // number that never flatters the position.
  it('rounds the fall down, never up', () => {
    expect(priceFallToReachBps(1_000, 3_000)).toBe(6_666);
  });

  it('says no fall at all when the line is at or under the target', () => {
    expect(priceFallToReachBps(6_500, 6_500)).toBe(0);
    expect(priceFallToReachBps(7_000, 6_500)).toBe(0);
  });

  it('says no fall when a number is missing rather than dividing by nothing', () => {
    expect(priceFallToReachBps(4_000, 0)).toBe(0);
    expect(priceFallToReachBps(0, 6_500)).toBe(0);
  });
});
