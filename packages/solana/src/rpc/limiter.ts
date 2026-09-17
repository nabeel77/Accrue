/**
 * A sliding window over the last second, shared by every caller of one client. The provider bills
 * and throttles by requests a second, so the limit belongs next to the transport rather than in
 * each route: one page that reads eight accounts must not be able to spend the whole budget.
 */
export interface RateLimiter {
  /** Resolves when the caller may make its request. */
  waitForATurn(): Promise<void>;
}

const A_SECOND_IN_MILLISECONDS = 1_000;

export function createRateLimiter(requestsPerSecond: number): RateLimiter {
  if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
    throw new Error('a rate limiter needs a positive number of requests a second');
  }

  const startedAt: number[] = [];
  let queue: Promise<void> = Promise.resolve();

  async function takeATurn(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (
        startedAt.length > 0 &&
        now - (startedAt[0] ?? 0) >= A_SECOND_IN_MILLISECONDS
      ) {
        startedAt.shift();
      }
      if (startedAt.length < requestsPerSecond) {
        startedAt.push(now);
        return;
      }
      const oldest = startedAt[0] ?? now;
      await sleep(A_SECOND_IN_MILLISECONDS - (now - oldest));
    }
  }

  return {
    waitForATurn(): Promise<void> {
      // Chained rather than run in parallel, so callers go through in the order they arrived and
      // nothing starves.
      const turn = queue.then(takeATurn);
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, Math.max(milliseconds, 1)));
}
