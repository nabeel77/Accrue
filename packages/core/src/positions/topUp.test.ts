import { describe, expect, it } from 'vitest';

import { SCALED_FRACTION_ONE } from '../money.js';
import {
  borrowForAddedValue,
  loanToValueBpsAfter,
  sizeATopUp,
  theBorrowToAskFor,
} from './topUp.js';

function dollars(whole: number): bigint {
  return BigInt(whole) * SCALED_FRACTION_ONE;
}

function inDollars(scaled: bigint): number {
  return Number(scaled) / Number(SCALED_FRACTION_ONE);
}

// The worked example from the program document: 1,000 dollars of NVDAx at 40 percent with 400
// dollars in ONyc, then 500 dollars more.
const THE_WORKED_EXAMPLE = {
  collateralValueScaled: dollars(1_000),
  adjustedDebtValueScaled: dollars(400),
  targetLtvBps: 4_000,
};

describe('the worked example', () => {
  const sizing = sizeATopUp(THE_WORKED_EXAMPLE, dollars(500));

  it('borrows what the target leaves room for once the new stock is in', () => {
    expect(inDollars(sizing.borrowValueScaled)).toBe(200);
  });

  it('holds 1,500 dollars of stock afterwards', () => {
    expect(inDollars(sizing.collateralValueAfterScaled)).toBe(1_500);
  });

  it('owes 600 dollars afterwards', () => {
    expect(inDollars(sizing.debtValueAfterScaled)).toBe(600);
  });

  it('is still at 40 percent, which is the point of a top up', () => {
    expect(sizing.loanToValueAfterBps).toBe(4_000);
  });
});

describe('what a position may borrow against value added to it', () => {
  it('borrows nothing when the position is already at its target', () => {
    expect(
      borrowForAddedValue(
        { ...THE_WORKED_EXAMPLE, adjustedDebtValueScaled: dollars(400) },
        0n,
      ),
    ).toBe(0n);
  });

  it('never returns less than nothing when the position is above its target', () => {
    expect(
      borrowForAddedValue(
        { ...THE_WORKED_EXAMPLE, adjustedDebtValueScaled: dollars(900) },
        dollars(100),
      ),
    ).toBe(0n);
  });

  it('takes the debt already there into account, not only the value added', () => {
    const behindTheTarget = {
      ...THE_WORKED_EXAMPLE,
      adjustedDebtValueScaled: dollars(200),
    };
    // 40 percent of 1,500 is 600, and 200 is already owed, so 400 is the room.
    expect(inDollars(borrowForAddedValue(behindTheTarget, dollars(500)))).toBe(400);
  });

  it('rounds against the position, so the borrow is never a hair over target', () => {
    const odd = {
      collateralValueScaled: 3n,
      adjustedDebtValueScaled: 0n,
      targetLtvBps: 3_333,
    };
    expect(borrowForAddedValue(odd, 0n)).toBe(0n);
  });
});

describe('the room the app leaves under the target', () => {
  it('asks for a little less than the room, so the debt lands under target', () => {
    const asked = theBorrowToAskFor(dollars(200));
    expect(inDollars(asked)).toBeCloseTo(199.8, 6);
    expect(asked).toBeLessThan(dollars(200));
  });

  it('leaves at least a cent, however small the room is', () => {
    expect(inDollars(theBorrowToAskFor(dollars(1)))).toBeCloseTo(0.99, 6);
  });

  it('asks for nothing at all when the room is under the margin', () => {
    expect(theBorrowToAskFor(SCALED_FRACTION_ONE / 200n)).toBe(0n);
  });

  it('lands a top up under its target rather than exactly on it', () => {
    const sizing = sizeATopUp(THE_WORKED_EXAMPLE, dollars(500), true);
    // Under the target by about what a one percent fall in the stock would cost it, and no more.
    expect(sizing.loanToValueAfterBps).toBeLessThan(4_000);
    expect(sizing.loanToValueAfterBps).toBeGreaterThan(3_950);
  });

  it('borrows less than the plain arithmetic would, and that is the point', () => {
    const asked = sizeATopUp(THE_WORKED_EXAMPLE, dollars(500), true);
    const plain = sizeATopUp(THE_WORKED_EXAMPLE, dollars(500));
    expect(asked.borrowValueScaled).toBeLessThan(plain.borrowValueScaled);
    expect(inDollars(asked.borrowValueScaled)).toBeCloseTo(193.8, 1);
  });
});

describe('the loan to value a top up lands at', () => {
  it('is nothing when the position holds nothing', () => {
    expect(loanToValueBpsAfter(0n, dollars(10))).toBe(0);
  });

  it('is what the two values say it is', () => {
    expect(loanToValueBpsAfter(dollars(1_000), dollars(300))).toBe(3_000);
  });
});
