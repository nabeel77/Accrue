import { describe, expect, it } from 'vitest';

import type { DeleverageSignals } from '@accrue/core';

import {
  decideWhatToDo,
  mostStretchedFirst,
  type GuardLimits,
  type PositionUnderWatch,
} from './decide.js';

const NVDAX_DEFAULTS = {
  protectLtvBps: 5_000,
  growBelowLtvBps: 3_000,
} as const;

const limits: GuardLimits = {
  minProtectIntervalSeconds: 600,
  minGrowIntervalSeconds: 3_600,
  maxPriceAgeSlots: 150,
  growPaused: false,
  sunset: false,
};

const now = { unixTimestamp: 1_800_000_000 };

const A_WEEK = 604_800n;
const nothingIsWrong: DeleverageSignals = {
  reserveStatusObsolete: false,
  programIsRetiring: false,
  obligationMarginCallStartedAt: 0n,
  marketAutodeleverageEnabled: false,
  reserveAutodeleverageEnabled: false,
  depositLimitCrossedAt: 0n,
  borrowLimitCrossedAt: 0n,
  marginCallPeriodSeconds: A_WEEK,
};
const aReserveTheMarketIsDeleveraging: DeleverageSignals = {
  ...nothingIsWrong,
  marketAutodeleverageEnabled: true,
  reserveAutodeleverageEnabled: true,
  depositLimitCrossedAt: BigInt(now.unixTimestamp) - A_WEEK,
};

function aPosition(overrides: Partial<PositionUnderWatch> = {}): PositionUnderWatch {
  return {
    isOpen: true,
    protectLtvBps: NVDAX_DEFAULTS.protectLtvBps,
    growBelowLtvBps: NVDAX_DEFAULTS.growBelowLtvBps,
    growEnabled: true,
    exitOnFlagEnabled: true,
    lastProtectAt: 0,
    lastGrowAt: 0,
    loanToValueBps: 4_000,
    destinationBalance: 1_000_000_000n,
    deleverage: nothingIsWrong,
    oldestPriceAgeSlots: 10,
    ...overrides,
  };
}

describe('what the keeper proposes', () => {
  it('leaves a position sitting between its two levels alone', () => {
    expect(decideWhatToDo(aPosition(), limits, now)).toEqual({
      kind: 'wait',
      reason: 'above the grow level and below the guard level',
    });
  });

  it('protects a position at its guard level', () => {
    expect(decideWhatToDo(aPosition({ loanToValueBps: 5_000 }), limits, now)).toEqual({
      kind: 'protect',
    });
  });

  it('protects a position past its guard level', () => {
    expect(decideWhatToDo(aPosition({ loanToValueBps: 6_200 }), limits, now)).toEqual({
      kind: 'protect',
    });
  });

  it('waits when the protect interval has not elapsed', () => {
    const position = aPosition({
      loanToValueBps: 5_500,
      lastProtectAt: now.unixTimestamp - 300,
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'the protect interval has not elapsed',
    });
  });

  it('protects again once the interval has elapsed', () => {
    const position = aPosition({
      loanToValueBps: 5_500,
      lastProtectAt: now.unixTimestamp - 600,
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({ kind: 'protect' });
  });

  it('waits on a stale price rather than proposing a protect that would revert', () => {
    const position = aPosition({ loanToValueBps: 5_500, oldestPriceAgeSlots: 151 });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'the oracle price is stale',
    });
  });

  it('waits when there is nothing left to sell', () => {
    const position = aPosition({ loanToValueBps: 5_500, destinationBalance: 0n });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'nothing left to sell',
    });
  });

  it('grows a position at or under its grow level', () => {
    expect(decideWhatToDo(aPosition({ loanToValueBps: 3_000 }), limits, now)).toEqual({
      kind: 'grow',
    });
    expect(decideWhatToDo(aPosition({ loanToValueBps: 1_200 }), limits, now)).toEqual({
      kind: 'grow',
    });
  });

  it('never grows while the guardian has growing paused', () => {
    const paused: GuardLimits = { ...limits, growPaused: true };
    expect(decideWhatToDo(aPosition({ loanToValueBps: 2_000 }), paused, now)).toEqual({
      kind: 'wait',
      reason: 'growing is paused',
    });
  });

  it('never grows a position whose owner switched growing off', () => {
    const position = aPosition({ loanToValueBps: 2_000, growEnabled: false });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'above the grow level and below the guard level',
    });
  });

  it('waits when the grow interval has not elapsed', () => {
    const position = aPosition({
      loanToValueBps: 2_000,
      lastGrowAt: now.unixTimestamp - 3_599,
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'the grow interval has not elapsed',
    });
  });

  it('hands a position back when the market has flagged its reserve', () => {
    const position = aPosition({
      deleverage: { ...nothingIsWrong, reserveStatusObsolete: true },
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({ kind: 'leave' });
  });

  it('leaves the flag alone when the owner switched that off', () => {
    const position = aPosition({
      deleverage: { ...nothingIsWrong, reserveStatusObsolete: true },
      exitOnFlagEnabled: false,
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'above the grow level and below the guard level',
    });
  });

  it('waits while the market itself is not deleveraging', () => {
    const position = aPosition({
      deleverage: {
        ...aReserveTheMarketIsDeleveraging,
        marketAutodeleverageEnabled: false,
      },
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'above the grow level and below the guard level',
    });
  });

  it('waits while the margin call period is still running', () => {
    const position = aPosition({
      deleverage: {
        ...aReserveTheMarketIsDeleveraging,
        depositLimitCrossedAt: BigInt(now.unixTimestamp) - A_WEEK + 1n,
      },
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'above the grow level and below the guard level',
    });
  });

  it('hands a position back once the margin call period has run out', () => {
    const position = aPosition({ deleverage: aReserveTheMarketIsDeleveraging });
    expect(decideWhatToDo(position, limits, now)).toEqual({ kind: 'leave' });
  });

  it('hands a position back on a margin call against that one obligation', () => {
    const position = aPosition({
      deleverage: {
        ...nothingIsWrong,
        obligationMarginCallStartedAt: BigInt(now.unixTimestamp),
      },
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({ kind: 'leave' });
  });

  it('hands every position back once the program is retiring', () => {
    const retiring: GuardLimits = { ...limits, sunset: true };
    const position = aPosition({ exitOnFlagEnabled: false });
    expect(decideWhatToDo(position, retiring, now)).toEqual({ kind: 'leave' });
  });

  it('protects before it leaves, because a flagged reserve still liquidates', () => {
    const position = aPosition({
      deleverage: { ...nothingIsWrong, reserveStatusObsolete: true },
      loanToValueBps: 5_500,
    });
    expect(decideWhatToDo(position, limits, now)).toEqual({ kind: 'protect' });
  });

  it('ignores a position that is not open', () => {
    const position = aPosition({ isOpen: false, loanToValueBps: 6_000 });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'not open',
    });
  });

  it('puts the most stretched position first', () => {
    const order = mostStretchedFirst([
      { loanToValueBps: 3_000 },
      { loanToValueBps: 6_100 },
      { loanToValueBps: 4_800 },
    ]);
    expect(order.map((entry) => entry.loanToValueBps)).toEqual([6_100, 4_800, 3_000]);
  });
});
