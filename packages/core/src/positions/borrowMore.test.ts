import { describe, expect, it } from 'vitest';

import { liquidationPrice, whatBorrowingMoreWouldDo } from './borrowMore.js';

const NVDAX_LIQUIDATION_THRESHOLD_BPS = 6_500;
const TARGET_BPS = 4_000;

// The example the tooltip shows: 2 NVDAx, 136 dollars owed, the stock 35 percent higher.
const TWO_NVDAX = whatBorrowingMoreWouldDo(
  2,
  230 / 1.35,
  136,
  TARGET_BPS,
  NVDAX_LIQUIDATION_THRESHOLD_BPS,
);

describe('what borrowing more would do', () => {
  it('says what the position can fall to today', () => {
    expect(TWO_NVDAX?.liquidatedBelowNow).toBeCloseTo(104.62, 2);
  });

  it('rises the stock by 35 percent', () => {
    expect(TWO_NVDAX?.risenTo).toBeCloseTo(230, 2);
  });

  it('leaves the debt alone with it off, so the rise is all safety', () => {
    expect(TWO_NVDAX?.debtWithItOff).toBe(136);
    expect(TWO_NVDAX?.liquidatedBelowWithItOff).toBeCloseTo(104.62, 2);
    expect(TWO_NVDAX?.fallWithItOffBps).toBeCloseTo(5_451, -1);
  });

  it('borrows back up to target with it on', () => {
    expect(TWO_NVDAX?.borrowedMore).toBeCloseTo(48, 2);
    expect(TWO_NVDAX?.debtWithItOn).toBeCloseTo(184, 2);
  });

  it('carries the price it can fall to up with the stock when it is on', () => {
    expect(TWO_NVDAX?.liquidatedBelowWithItOn).toBeCloseTo(141.54, 2);
    expect(TWO_NVDAX?.fallWithItOnBps).toBe(3_846);
  });

  it('is always the safer of the two with it off', () => {
    expect(TWO_NVDAX?.fallWithItOffBps).toBeGreaterThan(TWO_NVDAX?.fallWithItOnBps ?? 0);
  });

  it('borrows nothing more when the position is already past its target', () => {
    const past = whatBorrowingMoreWouldDo(
      2,
      100,
      200,
      TARGET_BPS,
      NVDAX_LIQUIDATION_THRESHOLD_BPS,
    );
    expect(past?.borrowedMore).toBe(0);
    expect(past?.debtWithItOn).toBe(200);
  });

  it('has nothing to say about a position with no stock in it', () => {
    expect(whatBorrowingMoreWouldDo(0, 100, 0, TARGET_BPS, 6_500)).toBeNull();
  });

  it('prices liquidation from the tokens and the threshold', () => {
    expect(liquidationPrice(2, 136, 6_500)).toBeCloseTo(104.62, 2);
    expect(liquidationPrice(0, 136, 6_500)).toBe(0);
  });
});
