import { describe, expect, it } from 'vitest';

import { howLongAgo, rawFromTypedAmount } from './format.js';

describe('the raw amount a sheet sends', () => {
  it('scales a typed amount by the decimals the chain reported', () => {
    expect(rawFromTypedAmount('1', 6)).toBe('1000000');
    expect(rawFromTypedAmount('0.5', 8)).toBe('50000000');
  });

  // A shape without the decimals used to make this throw inside a click handler, which left the
  // reader with a greyed button and no reason anywhere.
  it('refuses rather than throwing when the decimals are missing', () => {
    expect(rawFromTypedAmount('1', undefined as unknown as number)).toBe('0');
    expect(rawFromTypedAmount('1', Number.NaN)).toBe('0');
  });

  it('refuses something that is not a number, and anything under zero', () => {
    expect(rawFromTypedAmount('abc', 6)).toBe('0');
    expect(rawFromTypedAmount('-5', 6)).toBe('0');
    expect(rawFromTypedAmount('', 6)).toBe('0');
  });
});

describe('how long ago something was read', () => {
  it('counts seconds, then minutes, then hours', () => {
    expect(howLongAgo(30)).toBe('30 seconds ago');
    expect(howLongAgo(600)).toBe('10 minutes ago');
    expect(howLongAgo(7_200)).toBe('2 hours ago');
  });

  it('never reports a time before now', () => {
    expect(howLongAgo(-5)).toBe('0 seconds ago');
  });

  it('writes the sheet ages the way the copy reads them', () => {
    expect(howLongAgo(31)).toBe('31 seconds ago');
    expect(howLongAgo(300)).toBe('5 minutes ago');
  });

  it('drops the s on a single unit', () => {
    expect(howLongAgo(1)).toBe('1 second ago');
    expect(howLongAgo(90)).toBe('1 minute ago');
    expect(howLongAgo(5_400)).toBe('1 hour ago');
  });
});
