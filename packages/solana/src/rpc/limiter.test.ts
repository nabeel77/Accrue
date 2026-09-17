import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './limiter.js';

describe('the limiter every chain read goes through', () => {
  it('lets the first second of requests straight through', async () => {
    const limiter = createRateLimiter(5);
    const startedAt = Date.now();
    for (let request = 0; request < 5; request += 1) {
      await limiter.waitForATurn();
    }
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it('holds the one past the limit until the window moves', async () => {
    const limiter = createRateLimiter(2);
    const startedAt = Date.now();
    await limiter.waitForATurn();
    await limiter.waitForATurn();
    await limiter.waitForATurn();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  });

  it('refuses a rate that is not a positive number', () => {
    expect(() => createRateLimiter(0)).toThrow();
    expect(() => createRateLimiter(Number.NaN)).toThrow();
  });
});
