import { describe, expect, it } from 'vitest';

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
    reserveIsFlagged: false,
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
    const position = aPosition({ reserveIsFlagged: true });
    expect(decideWhatToDo(position, limits, now)).toEqual({ kind: 'leave' });
  });

  it('leaves the flag alone when the owner switched that off', () => {
    const position = aPosition({ reserveIsFlagged: true, exitOnFlagEnabled: false });
    expect(decideWhatToDo(position, limits, now)).toEqual({
      kind: 'wait',
      reason: 'above the grow level and below the guard level',
    });
  });

  it('hands every position back once the program is retiring', () => {
    const retiring: GuardLimits = { ...limits, sunset: true };
    const position = aPosition({ exitOnFlagEnabled: false });
    expect(decideWhatToDo(position, retiring, now)).toEqual({ kind: 'leave' });
  });

  it('protects before it leaves, because a flagged reserve still liquidates', () => {
    const position = aPosition({ loanToValueBps: 5_500, reserveIsFlagged: true });
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
