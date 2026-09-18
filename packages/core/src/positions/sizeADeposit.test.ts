import { describe, expect, it } from 'vitest';

import { sizeADeposit } from './defaults.js';

// The card's own example: 200 dollars of NVDAx at 40 percent into ONyc at 11.54 percent.
const A_TWO_HUNDRED_DOLLAR_DEPOSIT = sizeADeposit(200, 4_000, 1_154, 0);

describe('what a deposit borrows and earns', () => {
  it('borrows the target share of what was deposited', () => {
    expect(A_TWO_HUNDRED_DOLLAR_DEPOSIT.borrowUsd).toBe(80);
  });

  it('earns the spread on the borrowed amount, not on the deposit', () => {
    expect(A_TWO_HUNDRED_DOLLAR_DEPOSIT.earningsUsdAYear).toBeCloseTo(9.232, 3);
  });

  it('states that as a percent of the deposit', () => {
    expect(A_TWO_HUNDRED_DOLLAR_DEPOSIT.netYieldBps).toBe(462);
  });

  it('takes the loan rate off the yield, so a dear loan earns less', () => {
    const dearerLoan = sizeADeposit(200, 4_000, 1_154, 505);
    expect(dearerLoan.earningsUsdAYear).toBeCloseTo(5.192, 3);
    expect(dearerLoan.earningsUsdAYear).toBeLessThan(
      A_TWO_HUNDRED_DOLLAR_DEPOSIT.earningsUsdAYear,
    );
  });

  it('turns negative when the loan costs more than the yield pays', () => {
    const upsideDown = sizeADeposit(200, 4_000, 400, 1_200);
    expect(upsideDown.earningsUsdAYear).toBeLessThan(0);
    expect(upsideDown.netYieldBps).toBeLessThan(0);
  });

  it('buys the quoted amount of the yield token with what it borrows', () => {
    const quoted = sizeADeposit(200, 4_000, 1_154, 0, 0.980375);
    expect(quoted.destinationAmount).toBeCloseTo(78.43, 2);
  });

  it('says nothing about the yield token when no quote came back', () => {
    expect(A_TWO_HUNDRED_DOLLAR_DEPOSIT.destinationAmount).toBeNull();
  });

  it('earns nothing on nothing', () => {
    expect(sizeADeposit(0, 4_000, 1_154, 0).earningsUsdAYear).toBe(0);
    expect(sizeADeposit(0, 4_000, 1_154, 0).borrowUsd).toBe(0);
  });
});
