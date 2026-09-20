const BASIS_POINTS = 10_000;

export interface APositionsWorth {
  readonly collateralValueUsd: number;
  readonly debtUsd: number;
  readonly destinationValueUsd: number;
}

export interface PortfolioBreakdown {
  readonly stockInTheMarketUsd: number;
  readonly yieldTokensUsd: number;
  readonly owedUsd: number;
  readonly positionEquityUsd: number;
  readonly stockInYourWalletUsd: number;
  readonly usdcInYourWalletUsd: number;
  readonly everythingYouHoldUsd: number;
}

export function equityOfAPosition(worth: APositionsWorth): number {
  return worth.collateralValueUsd + worth.destinationValueUsd - worth.debtUsd;
}

export function breakDownThePortfolio(
  positions: readonly APositionsWorth[],
  stockInYourWalletUsd: number,
  usdcInYourWalletUsd: number,
): PortfolioBreakdown {
  const stockInTheMarketUsd = positions.reduce(
    (total, one) => total + one.collateralValueUsd,
    0,
  );
  const yieldTokensUsd = positions.reduce(
    (total, one) => total + one.destinationValueUsd,
    0,
  );
  const owedUsd = positions.reduce((total, one) => total + one.debtUsd, 0);
  const positionEquityUsd = stockInTheMarketUsd + yieldTokensUsd - owedUsd;
  return {
    stockInTheMarketUsd,
    yieldTokensUsd,
    owedUsd,
    positionEquityUsd,
    stockInYourWalletUsd,
    usdcInYourWalletUsd,
    everythingYouHoldUsd: positionEquityUsd + stockInYourWalletUsd + usdcInYourWalletUsd,
  };
}

export interface WhatItHasEarned {
  readonly earnedUsd: number;
  readonly earnedBps: number;
  readonly direction: 'up' | 'down' | 'flat';
}

export function whatThePositionsHaveEarned(
  positions: readonly APositionsWorth[],
): WhatItHasEarned {
  const yieldTokensUsd = positions.reduce(
    (total, one) => total + one.destinationValueUsd,
    0,
  );
  const owedUsd = positions.reduce((total, one) => total + one.debtUsd, 0);
  const earnedUsd = yieldTokensUsd - owedUsd;
  return {
    earnedUsd,
    earnedBps: owedUsd <= 0 ? 0 : Math.round((earnedUsd / owedUsd) * BASIS_POINTS),
    direction: earnedUsd > 0 ? 'up' : earnedUsd < 0 ? 'down' : 'flat',
  };
}

export interface HowItHasMoved {
  readonly changeUsd: number;
  readonly changeBps: number;
  readonly direction: 'up' | 'down' | 'flat';
}

export function howTheEquityHasMoved(from: number, to: number): HowItHasMoved {
  const changeUsd = to - from;
  const changeBps = from <= 0 ? 0 : Math.round((changeUsd / from) * BASIS_POINTS);
  return {
    changeUsd,
    changeBps,
    direction: changeUsd > 0 ? 'up' : changeUsd < 0 ? 'down' : 'flat',
  };
}

export interface APointInTime {
  readonly atMilliseconds: number;
  readonly equityUsd: number;
}

export function theLineToDraw(
  points: readonly APointInTime[],
  mostPoints: number,
): readonly APointInTime[] {
  if (points.length <= mostPoints) {
    return points;
  }
  const everyNth = Math.ceil(points.length / mostPoints);
  const thinned = points.filter((unused, index) => index % everyNth === 0);
  const last = points[points.length - 1];
  return last === undefined || thinned[thinned.length - 1] === last
    ? thinned
    : [...thinned, last];
}
