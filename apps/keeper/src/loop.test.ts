import type { Instruction } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import type { GuardLimits, PositionUnderWatch } from './decide.js';
import { runOneRound, type Candidate, type Round } from './loop.js';
import { createRunLogThatOnlyCounts } from './runs.js';

const limits: GuardLimits = {
  minProtectIntervalSeconds: 600,
  minGrowIntervalSeconds: 3_600,
  maxPriceAgeSlots: 150,
  growPaused: false,
  sunset: false,
};

const somethingToSend = {} as Instruction;

function watched(overrides: Partial<PositionUnderWatch>): PositionUnderWatch {
  return {
    isOpen: true,
    protectLtvBps: 5_000,
    growBelowLtvBps: 3_000,
    growEnabled: true,
    exitOnFlagEnabled: true,
    lastProtectAt: 0,
    lastGrowAt: 0,
    loanToValueBps: 4_000,
    destinationBalance: 1_000n,
    deleverage: {
      reserveStatusObsolete: false,
      programIsRetiring: false,
      obligationMarginCallStartedAt: 0n,
      marketAutodeleverageEnabled: false,
      reserveAutodeleverageEnabled: false,
      depositLimitCrossedAt: 0n,
      borrowLimitCrossedAt: 0n,
      marginCallPeriodSeconds: 604_800n,
    },
    oldestPriceAgeSlots: 1,
    ...overrides,
  };
}

function candidate(address: string, loanToValueBps: number): Candidate<null> {
  return { address, loanToValueBps, watched: watched({ loanToValueBps }), subject: null };
}

function aRound(candidates: Candidate<null>[]): Round<null> {
  return { limits, unixTimestamp: 1_800_000_000, candidates };
}

describe('one round of the guard', () => {
  it('sends nothing when every position sits inside its band', async () => {
    const runLog = createRunLogThatOnlyCounts();
    const report = await runOneRound(
      aRound([candidate('AAAA1111', 4_000), candidate('BBBB2222', 4_200)]),
      { build: () => Promise.resolve(somethingToSend) },
      () => Promise.reject(new Error('nothing should have been sent')),
      runLog,
      () => undefined,
    );

    expect(report).toEqual({ considered: 2, attempted: 0, landed: 0 });
    // Nothing was sent, but both positions were looked at, and that is what a screen reads to
    // say the guard is still being run.
    expect(runLog.recorded.map((run) => run.kind)).toEqual(['check', 'check']);
    expect(runLog.recorded.map((run) => run.outcome)).toEqual(['skipped', 'skipped']);
  });

  it('takes the most stretched position first and records what landed', async () => {
    const runLog = createRunLogThatOnlyCounts();
    const sent: string[] = [];

    const report = await runOneRound(
      aRound([
        candidate('AAAA1111', 5_100),
        candidate('BBBB2222', 4_000),
        candidate('CCCC3333', 6_400),
      ]),
      {
        build: (entry) => {
          sent.push(entry.address);
          return Promise.resolve(somethingToSend);
        },
      },
      () => Promise.resolve('a signature'),
      runLog,
      () => undefined,
    );

    expect(sent).toEqual(['CCCC3333', 'AAAA1111']);
    expect(report).toEqual({ considered: 3, attempted: 2, landed: 2 });
    expect(runLog.recorded.map((run) => run.outcome)).toEqual([
      'landed',
      'landed',
      'skipped',
    ]);
    expect(runLog.recorded[0]?.kind).toBe('protect');
    expect(runLog.recorded[0]?.signature).toBe('a signature');
  });

  it('records a revert with its reason and carries on to the next position', async () => {
    const runLog = createRunLogThatOnlyCounts();
    let attempt = 0;

    const report = await runOneRound(
      aRound([candidate('AAAA1111', 6_000), candidate('BBBB2222', 5_500)]),
      { build: () => Promise.resolve(somethingToSend) },
      () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error('the router had no route'))
          : Promise.resolve('a signature');
      },
      runLog,
      () => undefined,
    );

    expect(report).toEqual({ considered: 2, attempted: 2, landed: 1 });
    expect(runLog.recorded.map((run) => run.outcome)).toEqual(['reverted', 'landed']);
    expect(runLog.recorded[0]?.reason).toBe('the router had no route');
    expect(runLog.recorded[0]?.signature).toBeNull();
  });

  it('writes nothing about a position beyond its address', async () => {
    const runLog = createRunLogThatOnlyCounts();
    await runOneRound(
      aRound([candidate('AAAA1111', 6_000)]),
      { build: () => Promise.resolve(somethingToSend) },
      () => Promise.resolve('a signature'),
      runLog,
      () => undefined,
    );

    expect(Object.keys(runLog.recorded[0] ?? {})).toEqual([
      'positionAddress',
      'kind',
      'outcome',
      'signature',
      'reason',
      'durationMs',
    ]);
  });

  it('reports a landing with a shortened address and never a whole one', async () => {
    const lines: string[] = [];
    await runOneRound(
      aRound([candidate('AAAABBBBCCCCDDDD', 6_000)]),
      { build: () => Promise.resolve(somethingToSend) },
      () => Promise.resolve('a signature'),
      createRunLogThatOnlyCounts(),
      (line) => lines.push(line),
    );

    expect(lines).toEqual(['protect landed on AAAA…DDDD']);
    expect(lines[0]).not.toContain('AAAABBBBCCCCDDDD');
  });
});
