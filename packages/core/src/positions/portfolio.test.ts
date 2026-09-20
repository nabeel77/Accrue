import { describe, expect, it } from 'vitest';

import {
  breakDownThePortfolio,
  equityOfAPosition,
  howTheEquityHasMoved,
  theLineToDraw,
  whatThePositionsHaveEarned,
} from './portfolio.js';

const SPYX = { collateralValueUsd: 2_012.52, debtUsd: 990, destinationValueUsd: 970.48 };
const NVDAX = {
  collateralValueUsd: 2_947.58,
  debtUsd: 1_011.28,
  destinationValueUsd: 989.45,
};

describe('what a position is worth', () => {
  it('is the stock and the yield token less what is owed', () => {
    expect(equityOfAPosition(SPYX)).toBeCloseTo(1_993.0, 2);
    expect(equityOfAPosition(NVDAX)).toBeCloseTo(2_925.75, 2);
  });

  it('is negative when the loan is worth more than everything held', () => {
    expect(
      equityOfAPosition({
        collateralValueUsd: 100,
        debtUsd: 400,
        destinationValueUsd: 50,
      }),
    ).toBe(-250);
  });
});

describe('the whole portfolio', () => {
  it('adds the positions up and keeps the wallet beside them', () => {
    const broken = breakDownThePortfolio([SPYX, NVDAX], 19_685, 1_000);

    expect(broken.stockInTheMarketUsd).toBeCloseTo(4_960.1, 2);
    expect(broken.yieldTokensUsd).toBeCloseTo(1_959.93, 2);
    expect(broken.owedUsd).toBeCloseTo(2_001.28, 2);
    expect(broken.positionEquityUsd).toBeCloseTo(4_918.75, 2);
    expect(broken.everythingYouHoldUsd).toBeCloseTo(25_603.75, 2);
  });

  it('is the wallet alone when nothing is deposited', () => {
    const broken = breakDownThePortfolio([], 500, 250);

    expect(broken.positionEquityUsd).toBe(0);
    expect(broken.everythingYouHoldUsd).toBe(750);
  });
});

describe('how the equity has moved', () => {
  it('reads a rise in dollars and basis points', () => {
    const moved = howTheEquityHasMoved(4_784.14, 4_918.75);

    expect(moved.changeUsd).toBeCloseTo(134.61, 2);
    expect(moved.changeBps).toBe(281);
    expect(moved.direction).toBe('up');
  });

  it('reads a fall', () => {
    const moved = howTheEquityHasMoved(1_000, 900);

    expect(moved.changeUsd).toBe(-100);
    expect(moved.changeBps).toBe(-1_000);
    expect(moved.direction).toBe('down');
  });

  it('says nothing moved rather than dividing by nothing', () => {
    expect(howTheEquityHasMoved(0, 0)).toStrictEqual({
      changeUsd: 0,
      changeBps: 0,
      direction: 'flat',
    });
    expect(howTheEquityHasMoved(0, 50).changeBps).toBe(0);
  });
});

describe('the line the chart draws', () => {
  const many = Array.from({ length: 1_301 }, (unused, index) => ({
    atMilliseconds: index,
    equityUsd: index,
  }));

  it('keeps every point when there are few enough', () => {
    expect(theLineToDraw(many.slice(0, 40), 120)).toHaveLength(40);
  });

  it('thins a long history down and always keeps the newest point', () => {
    const drawn = theLineToDraw(many, 120);

    expect(drawn.length).toBeLessThanOrEqual(121);
    expect(drawn[0]?.atMilliseconds).toBe(0);
    expect(drawn[drawn.length - 1]?.atMilliseconds).toBe(1_300);
  });

  it('draws nothing from nothing', () => {
    expect(theLineToDraw([], 120)).toStrictEqual([]);
  });
});

describe('whatThePositionsHaveEarned', () => {
  it('has earned nothing the moment the loan bought the yield token', () => {
    const earned = whatThePositionsHaveEarned([
      { collateralValueUsd: 2_500, debtUsd: 1_000, destinationValueUsd: 1_000 },
    ]);
    expect(earned).toEqual({ earnedUsd: 0, earnedBps: 0, direction: 'flat' });
  });

  it('counts what the yield token is worth above what is still owed', () => {
    const earned = whatThePositionsHaveEarned([
      { collateralValueUsd: 2_500, debtUsd: 1_000, destinationValueUsd: 1_115.4 },
    ]);
    expect(earned.earnedUsd).toBeCloseTo(115.4, 6);
    expect(earned.earnedBps).toBe(1_154);
    expect(earned.direction).toBe('up');
  });

  it('goes down when the loan has cost more than the yield token made', () => {
    const earned = whatThePositionsHaveEarned([
      { collateralValueUsd: 2_500, debtUsd: 1_020, destinationValueUsd: 1_000 },
    ]);
    expect(earned.earnedUsd).toBeCloseTo(-20, 6);
    expect(earned.earnedBps).toBe(-196);
    expect(earned.direction).toBe('down');
  });

  it('adds every position together', () => {
    const earned = whatThePositionsHaveEarned([
      { collateralValueUsd: 2_500, debtUsd: 1_000, destinationValueUsd: 1_050 },
      { collateralValueUsd: 900, debtUsd: 500, destinationValueUsd: 530 },
    ]);
    expect(earned.earnedUsd).toBeCloseTo(80, 6);
    expect(earned.earnedBps).toBe(533);
  });

  it('says nothing rather than dividing by a loan of nothing', () => {
    const earned = whatThePositionsHaveEarned([
      { collateralValueUsd: 2_500, debtUsd: 0, destinationValueUsd: 0 },
    ]);
    expect(earned).toEqual({ earnedUsd: 0, earnedBps: 0, direction: 'flat' });
  });

  it('is nothing when there are no positions at all', () => {
    expect(whatThePositionsHaveEarned([])).toEqual({
      earnedUsd: 0,
      earnedBps: 0,
      direction: 'flat',
    });
  });
});
