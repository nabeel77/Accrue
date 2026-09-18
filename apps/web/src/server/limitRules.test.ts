import { describe, expect, it } from 'vitest';

import {
  A_MINUTE_IN_MILLISECONDS,
  bucketKey,
  callerFromForwardedFor,
  isWithinTheAllowance,
  LIMIT_VARIABLES,
  retryAfterSeconds,
  theWindowStart,
} from './limitRules.js';

const A_MINUTE_BOUNDARY = 1_800_000_060_000;

describe('the window a limit counts in', () => {
  it('starts at the minute, so every caller shares the same boundary', () => {
    expect(theWindowStart(A_MINUTE_BOUNDARY + 1)).toBe(A_MINUTE_BOUNDARY);
    expect(theWindowStart(A_MINUTE_BOUNDARY + 59_999)).toBe(A_MINUTE_BOUNDARY);
    expect(theWindowStart(A_MINUTE_BOUNDARY + A_MINUTE_IN_MILLISECONDS)).toBe(
      A_MINUTE_BOUNDARY + A_MINUTE_IN_MILLISECONDS,
    );
  });

  it('tells the caller how long is left, never less than a second', () => {
    expect(retryAfterSeconds(A_MINUTE_BOUNDARY, A_MINUTE_BOUNDARY)).toBe(60);
    expect(retryAfterSeconds(A_MINUTE_BOUNDARY, A_MINUTE_BOUNDARY + 30_000)).toBe(30);
    expect(retryAfterSeconds(A_MINUTE_BOUNDARY, A_MINUTE_BOUNDARY + 59_900)).toBe(1);
    expect(retryAfterSeconds(A_MINUTE_BOUNDARY, A_MINUTE_BOUNDARY + 120_000)).toBe(1);
  });
});

describe('the bucket a count lands in', () => {
  it('names the route, the caller and the window, so nothing is shared by accident', () => {
    expect(bucketKey('positions/build', 'WALLET', A_MINUTE_BOUNDARY)).toBe(
      `positions/build:WALLET:${A_MINUTE_BOUNDARY}`,
    );
  });

  it('gives two callers on one route two buckets', () => {
    expect(bucketKey('positions/build', 'one', A_MINUTE_BOUNDARY)).not.toBe(
      bucketKey('positions/build', 'two', A_MINUTE_BOUNDARY),
    );
  });

  it('gives one caller on two routes two buckets', () => {
    expect(bucketKey('positions/build', 'one', A_MINUTE_BOUNDARY)).not.toBe(
      bucketKey('positions/submit', 'one', A_MINUTE_BOUNDARY),
    );
  });

  it('gives the next minute a new bucket', () => {
    expect(bucketKey('a', 'b', A_MINUTE_BOUNDARY)).not.toBe(
      bucketKey('a', 'b', A_MINUTE_BOUNDARY + A_MINUTE_IN_MILLISECONDS),
    );
  });
});

describe('the verdict', () => {
  it('allows the allowance and refuses the one after it', () => {
    expect(isWithinTheAllowance(6, 6)).toBe(true);
    expect(isWithinTheAllowance(7, 6)).toBe(false);
  });

  it('refuses everything when the allowance is nothing', () => {
    expect(isWithinTheAllowance(1, 0)).toBe(false);
  });
});

describe('every limit', () => {
  it('reads one variable and falls back to the number in the example file', () => {
    expect(LIMIT_VARIABLES.nonce).toStrictEqual({
      variable: 'RATE_LIMIT_NONCE_PER_IP',
      fallback: 10,
    });
    expect(LIMIT_VARIABLES.verify).toStrictEqual({
      variable: 'RATE_LIMIT_VERIFY_PER_IP',
      fallback: 10,
    });
    expect(LIMIT_VARIABLES.build).toStrictEqual({
      variable: 'RATE_LIMIT_BUILD_PER_WALLET',
      fallback: 6,
    });
    expect(LIMIT_VARIABLES.submit).toStrictEqual({
      variable: 'RATE_LIMIT_SUBMIT_PER_WALLET',
      fallback: 6,
    });
    expect(LIMIT_VARIABLES.read).toStrictEqual({
      variable: 'RATE_LIMIT_READ_PER_WALLET',
      fallback: 60,
    });
    expect(LIMIT_VARIABLES.faucet).toStrictEqual({
      variable: 'RATE_LIMIT_FAUCET_PER_WALLET',
      fallback: 2,
    });
  });

  it('has a name for every route that answers a browser', () => {
    expect(Object.keys(LIMIT_VARIABLES).sort()).toStrictEqual([
      'build',
      'faucet',
      'nonce',
      'read',
      'submit',
      'verify',
    ]);
  });
});

describe('who a request is counted against', () => {
  it('takes the first address a proxy chain names', () => {
    expect(callerFromForwardedFor('203.0.113.7, 198.51.100.2')).toBe('203.0.113.7');
  });

  it('counts a request with no forwarded address against one shared bucket', () => {
    expect(callerFromForwardedFor(null)).toBe('unknown');
  });
});
