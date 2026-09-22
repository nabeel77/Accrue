export const A_MINUTE_IN_MILLISECONDS = 60_000;

export type LimitName =
  'nonce' | 'verify' | 'build' | 'submit' | 'read' | 'faucet' | 'marketMove';

// The variable each limit is read from, and the number it falls back to when nothing is set.
export const LIMIT_VARIABLES: Readonly<
  Record<LimitName, { readonly variable: string; readonly fallback: number }>
> = {
  nonce: { variable: 'RATE_LIMIT_NONCE_PER_IP', fallback: 10 },
  verify: { variable: 'RATE_LIMIT_VERIFY_PER_IP', fallback: 10 },
  build: { variable: 'RATE_LIMIT_BUILD_PER_WALLET', fallback: 20 },
  submit: { variable: 'RATE_LIMIT_SUBMIT_PER_WALLET', fallback: 6 },
  read: { variable: 'RATE_LIMIT_READ_PER_WALLET', fallback: 60 },
  faucet: { variable: 'RATE_LIMIT_FAUCET_PER_WALLET', fallback: 2 },
  marketMove: { variable: 'RATE_LIMIT_MARKET_MOVE_PER_WALLET', fallback: 60 },
};

export function theWindowStart(nowMilliseconds: number): number {
  return (
    Math.floor(nowMilliseconds / A_MINUTE_IN_MILLISECONDS) * A_MINUTE_IN_MILLISECONDS
  );
}

export function bucketKey(route: string, key: string, windowStart: number): string {
  return `${route}:${key}:${windowStart}`;
}

export function retryAfterSeconds(windowStart: number, nowMilliseconds: number): number {
  const left = windowStart + A_MINUTE_IN_MILLISECONDS - nowMilliseconds;
  return Math.max(Math.ceil(left / 1_000), 1);
}

export function isWithinTheAllowance(used: number, allowance: number): boolean {
  return used <= allowance;
}

// Every caller of a route shares nothing: the key is the whole identity of the bucket.
export function callerFromForwardedFor(forwarded: string | null): string {
  return (forwarded?.split(',')[0] ?? 'unknown').trim();
}
