import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  type Rpc,
  type RpcTransport,
  type SolanaRpcApi,
} from '@solana/kit';

import { createRateLimiter, type RateLimiter } from './limiter.js';

const DEFAULT_REQUESTS_PER_SECOND = 20;

export interface AccrueRpcOptions {
  readonly url: string;
  readonly requestsPerSecond?: number;
}

export interface AccrueRpc {
  readonly rpc: Rpc<SolanaRpcApi>;
  readonly limiter: RateLimiter;
}

/**
 * Every read the app makes goes through one client, and every request through our own limiter
 * before it reaches the provider. Nothing above this calls `fetch` at a Solana endpoint.
 */
export function createAccrueRpc(options: AccrueRpcOptions): AccrueRpc {
  const limiter = createRateLimiter(
    options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND,
  );
  const transport = createDefaultRpcTransport({ url: options.url });
  return {
    rpc: createSolanaRpcFromTransport(limitedBy(limiter, transport)),
    limiter,
  };
}

function limitedBy(limiter: RateLimiter, transport: RpcTransport): RpcTransport {
  return async function limitedTransport(...args) {
    await limiter.waitForATurn();
    return transport(...args);
  };
}

export function requestsPerSecondFromTheEnvironment(): number {
  const raw = process.env['HELIUS_MAX_REQUESTS_PER_SECOND'];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUESTS_PER_SECOND;
}
