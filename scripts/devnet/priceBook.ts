import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { devnetDirectory } from './shared.js';
import { SANDBOX_TOKENS } from './tokens.js';

const PRICES_FILE = 'prices.json';

// What the sandbox believes each token is worth right now, in dollars, between runs.
export function priceBookPath(): string {
  return resolve(devnetDirectory(), PRICES_FILE);
}

export function startingPrices(): Record<string, number> {
  return Object.fromEntries(
    SANDBOX_TOKENS.map((token) => [token.symbol, token.startingPrice]),
  );
}

export function currentPrices(): Record<string, number> {
  const path = priceBookPath();
  if (!existsSync(path)) {
    return startingPrices();
  }
  return {
    ...startingPrices(),
    ...(JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>),
  };
}

export function savePrices(prices: Record<string, number>): void {
  writeFileSync(priceBookPath(), `${JSON.stringify(prices, null, 2)}\n`);
}
