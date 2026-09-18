import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  type Rpc,
  type RpcTransport,
  type SolanaRpcApi,
} from '@solana/kit';

import { createRateLimiter, type RateLimiter } from './limiter.js';

const DEFAULT_REQUESTS_PER_SECOND = 20;
const A_CALL_HAS_TWENTY_SECONDS = 20_000;

export interface AccrueRpcOptions {
  readonly url: string;
  readonly requestsPerSecond?: number;
}

export interface AccrueRpc {
  readonly rpc: Rpc<SolanaRpcApi>;
  readonly limiter: RateLimiter;
}

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

export class TheCallTookTooLong extends Error {
  constructor(readonly method: string) {
    super(`the ${method} call took longer than twenty seconds`);
    this.name = 'TheCallTookTooLong';
  }
}

function methodOf(args: Parameters<RpcTransport>): string {
  const payload = (args[0] as { payload?: { method?: string } }).payload;
  return payload?.method ?? 'chain';
}

// Waiting a turn is part of the call, so the deadline covers the queue as well as the request.
function limitedBy(limiter: RateLimiter, transport: RpcTransport): RpcTransport {
  return function limitedTransport<TResponse>(
    ...args: Parameters<RpcTransport>
  ): Promise<TResponse> {
    const method = methodOf(args);
    let ring: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_keep, giveUp) => {
      ring = setTimeout(() => {
        giveUp(new TheCallTookTooLong(method));
      }, A_CALL_HAS_TWENTY_SECONDS);
    });
    const call = (async (): Promise<TResponse> => {
      await limiter.waitForATurn();
      return transport<TResponse>(...args);
    })();
    return Promise.race([call, deadline]).finally(() => {
      clearTimeout(ring);
    });
  };
}

export function requestsPerSecondFromTheEnvironment(): number {
  const raw = process.env['HELIUS_MAX_REQUESTS_PER_SECOND'];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUESTS_PER_SECOND;
}
