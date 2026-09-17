import 'server-only';

import {
  createAccrueRpc,
  createSwapRouter,
  requestsPerSecondFromTheEnvironment,
  type SwapRouter,
} from '@accrue/solana';

import { CAPS, optional, rpcUrl } from './env.js';

const BASIS_POINTS_PER_PERCENT = 100;

let shared: ReturnType<typeof createAccrueRpc> | null = null;

/** One client for the whole server, so the limiter is shared by every route. */
export function chain(): ReturnType<typeof createAccrueRpc> {
  shared ??= createAccrueRpc({
    url: rpcUrl(),
    requestsPerSecond: requestsPerSecondFromTheEnvironment(),
  });
  return shared;
}

export function swapRouter(): SwapRouter {
  return createSwapRouter({
    rpc: chain().rpc,
    jupiterApiUrl: optional('JUPITER_API_URL') ?? 'https://lite-api.jup.ag',
    jupiterApiKey: optional('JUPITER_API_KEY'),
    maxSlippageBps: CAPS.maxSlippageBps(),
    maxPriceImpactBps: CAPS.maxPriceImpactPct() * BASIS_POINTS_PER_PERCENT,
  });
}

export function nowUnixTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1_000));
}
