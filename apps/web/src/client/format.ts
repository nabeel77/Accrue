'use client';

const SCALED_FRACTION_ONE = 2n ** 60n;

export function fromScaled(scaled: string): number {
  return Number(BigInt(scaled)) / Number(SCALED_FRACTION_ONE);
}

export function rawToWhole(raw: string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

// What a typed amount is worth in raw units. A shape without decimals gives nothing rather than
// throwing inside a click handler, and nothing under zero is ever sent.
export function rawFromTypedAmount(typed: string, decimals: number): string {
  const raw = Math.round(Number(typed) * 10 ** decimals);
  return Number.isFinite(raw) && raw >= 0 ? BigInt(raw).toString() : '0';
}

export function wholeToRaw(whole: number, decimals: number): string {
  return BigInt(Math.round(whole * 10 ** decimals)).toString();
}

export function percent(bps: number, places = 2): string {
  return `${(bps / 100).toFixed(places)}%`;
}

export function money(value: number, places = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

function countOf(howMany: number, unit: string): string {
  return `${howMany} ${unit}${howMany === 1 ? '' : 's'}`;
}

export function howLong(elapsedSeconds: number): string {
  const seconds = Math.max(Math.floor(elapsedSeconds), 0);
  if (seconds < 90) {
    return countOf(seconds, 'second');
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) {
    return countOf(minutes, 'minute');
  }
  return countOf(Math.floor(minutes / 60), 'hour');
}

export function howLongAgo(elapsedSeconds: number): string {
  return `${howLong(elapsedSeconds)} ago`;
}

export function ago(unixSeconds: number): string {
  if (unixSeconds === 0) {
    return 'never';
  }
  return howLongAgo(Math.floor(Date.now() / 1_000) - unixSeconds);
}
