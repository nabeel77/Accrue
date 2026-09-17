'use client';

const SCALED_FRACTION_ONE = 2n ** 60n;

export function fromScaled(scaled: string): number {
  return Number(BigInt(scaled)) / Number(SCALED_FRACTION_ONE);
}

export function rawToWhole(raw: string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
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

export function ago(unixSeconds: number): string {
  if (unixSeconds === 0) {
    return 'never';
  }
  const seconds = Math.max(Math.floor(Date.now() / 1_000) - unixSeconds, 0);
  if (seconds < 90) {
    return `${seconds} seconds ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) {
    return `${minutes} minutes ago`;
  }
  return `${Math.floor(minutes / 60)} hours ago`;
}
