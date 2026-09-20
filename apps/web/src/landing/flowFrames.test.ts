import { describe, expect, it } from 'vitest';

import {
  colourForLoanToValue,
  FLOW_STEPS,
  frameFor,
  GUARD,
  liquidationPriceFor,
  loanAfterTheGuardActs,
  loanToValueAt,
  theGuardPrice,
} from './flowFrames.js';

describe('the five frames of the flow', () => {
  it('starts with the stock outside the position and nothing else showing', () => {
    const first = frameFor(0);

    expect(first.stockX).toBe(24);
    expect(first.coinOpacity).toBe(0);
    expect(first.gaugeOpacity).toBe(0);
    expect(first.boxStroke).toBe('#22201D');
  });

  it('lights the position and the borrow gauge on the second frame', () => {
    const second = frameFor(1);

    expect(second.boxStroke).toBe('#37B98D');
    expect(second.stockX).toBe(50);
    expect(second.gaugeDash).toBe('50 126');
    expect(second.gaugeText).toBe('40%');
    expect(second.coinLabel).toBe('USDC');
  });

  it('turns the coins into the yield token on the third', () => {
    const third = frameFor(2);

    expect(third.coinLabel).toBe('ONyc');
    expect(third.coinStroke).toBe('#E2B871');
    expect(third.counterOpacity).toBe(1);
  });

  it('drops the loan and the liquidation line when the guard acts', () => {
    const fourth = frameFor(3);

    expect(fourth.chartOpacity).toBe(1);
    expect(fourth.loanWidth).toBe(112);
    expect(fourth.gaugeText).toBe('31%');
    expect(fourth.liquidationY).toBe(200);
    expect(fourth.tickOpacity).toBe(1);
  });

  it('sends everything back to the wallet with the profit on the last', () => {
    const fifth = frameFor(4);

    expect(fifth.stockX).toBe(24);
    expect(fifth.coinOneX).toBe(24);
    expect(fifth.loanWidth).toBe(0);
    expect(fifth.profitOpacity).toBe(1);
    expect(fifth.boxStroke).toBe('#22201D');
  });

  it('has a frame for every step', () => {
    for (let step = 0; step < FLOW_STEPS; step += 1) {
      expect(frameFor(step).gaugeDash).toBeTypeOf('string');
    }
  });
});

describe('the guard the landing page lets you drag', () => {
  it('watches at the price the design names', () => {
    expect(theGuardPrice()).toBeCloseTo(151.11, 2);
    expect(liquidationPriceFor(GUARD.loan)).toBeCloseTo(104.62, 2);
  });

  it('starts at forty percent', () => {
    expect(loanToValueAt(GUARD.loan, GUARD.start)).toBeCloseTo(0.4, 4);
  });

  it('repays back to target and carries the liquidation price down', () => {
    const after = loanAfterTheGuardActs();

    expect(GUARD.loan - after).toBeCloseTo(15.11, 2);
    expect(after).toBeCloseTo(120.89, 2);
    expect(liquidationPriceFor(after)).toBeCloseTo(92.99, 2);
  });

  it('colours the bar by how close the loan is to liquidation', () => {
    expect(colourForLoanToValue(0.4)).toBe('#6FD08C');
    expect(colourForLoanToValue(0.5)).toBe('#E8B03A');
    expect(colourForLoanToValue(0.7)).toBe('#E2685C');
  });
});
