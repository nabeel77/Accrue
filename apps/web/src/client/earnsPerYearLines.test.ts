import { netYieldBps } from '@accrue/core';
import { describe, expect, it } from 'vitest';

import { earnsPerYearLines } from './earnsPerYearLines.js';

const A_NVDAX_ROW = {
  stockSymbol: 'NVDAx',
  destinationSymbol: 'ONyc',
  targetLtvBps: 4_000,
  destinationRateBps: 1_154,
  borrowRateBps: 500,
  netYieldBps: netYieldBps(4_000, 1_154, 500),
};

describe('the working behind a stock row percent', () => {
  it('shows the sum that produced the number, in the worked example figures', () => {
    const said = earnsPerYearLines(A_NVDAX_ROW)
      .map((line) => line.text)
      .join(' ');
    expect(said).toBe(
      'What a NVDAx deposit earns you per year after the loan cost, with ONyc selected. ' +
        "Accrue borrows 40% of your stock's value, ONyc pays 11.54%, the loan costs 5.00%: " +
        '40% × (11.54% − 5.00%) = 2.62%. Not a promise. Both rates move.',
    );
  });

  it('shows the same percent the row shows', () => {
    expect(A_NVDAX_ROW.netYieldBps).toBe(262);
  });

  it('names whichever stock and yield token the screen has chosen', () => {
    const [first] = earnsPerYearLines({
      ...A_NVDAX_ROW,
      stockSymbol: 'SPYx',
      destinationSymbol: 'ONre',
    });
    expect(first?.text).toBe(
      'What a SPYx deposit earns you per year after the loan cost, with ONre selected.',
    );
  });
});
