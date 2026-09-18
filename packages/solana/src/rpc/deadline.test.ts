import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './limiter.js';

describe('the queue', () => {
  it('advances after a turn that rejects exactly as after one that resolves', async () => {
    const limiter = createRateLimiter(1);
    const order: string[] = [];

    const first = limiter.waitForATurn().then(() => {
      order.push('first');
      throw new Error('this one gave up');
    });
    const second = limiter.waitForATurn().then(() => {
      order.push('second');
    });

    await expect(first).rejects.toThrow('this one gave up');
    await second;
    expect(order).toEqual(['first', 'second']);
  });

  it('lets callers through in the order they arrived', async () => {
    const limiter = createRateLimiter(2);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map(async (which) => {
        await limiter.waitForATurn();
        order.push(which);
      }),
    );
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
