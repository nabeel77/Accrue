import { describe, expect, it } from 'vitest';

import { capacityLeft } from './caps.js';
import type { WithdrawalCapSnapshot } from './layout.js';

const A_DAY = 86_400n;
const NOW = 1_789_000_000n;

function cap(overrides: Partial<WithdrawalCapSnapshot> = {}): WithdrawalCapSnapshot {
  return {
    capacity: 1_000_000n,
    usedInThisWindow: 250_000n,
    windowStartedAt: NOW - 3_600n,
    windowLengthSeconds: A_DAY,
    ...overrides,
  };
}

describe('what is left of a rolling cap', () => {
  it('takes what the window has already used off the capacity', () => {
    const left = capacityLeft(cap(), NOW);
    expect(left.isCapped).toBe(true);
    expect(left.remaining).toBe(750_000n);
    expect(left.windowResetsAt).toBe(NOW - 3_600n + A_DAY);
  });

  it('counts a window that has already run out as empty again', () => {
    const left = capacityLeft(cap({ windowStartedAt: NOW - A_DAY - 1n }), NOW);
    expect(left.remaining).toBe(1_000_000n);
    expect(left.windowResetsAt).toBe(NOW + A_DAY);
  });

  it('never reports a negative remainder', () => {
    expect(capacityLeft(cap({ usedInThisWindow: 1_500_000n }), NOW).remaining).toBe(0n);
  });

  it('says so when the market has turned the cap off', () => {
    const off = capacityLeft(cap({ capacity: -1n }), NOW);
    expect(off.isCapped).toBe(false);
    expect(off.remaining).toBe(0n);
  });
});
