import type { Rpc, SolanaRpcApi } from '@solana/kit';

import { clusterName } from '../clusters/index.js';
import { createJupiterRouter } from './jupiter.js';
import { createSandboxRouter } from './sandbox.js';
import type { SwapRouter } from './router.js';

export { NoRouteFound } from './router.js';
export type { SwapRouter } from './router.js';
export { createJupiterRouter } from './jupiter.js';
export {
  createSandboxRouter,
  decodeSandboxPool,
  fillAtTheSandboxRate,
  findSandboxPoolAddress,
  findSandboxSwapAuthority,
  sandboxRouteOutput,
  SANDBOX_POOL_ACCOUNT_LENGTH,
  SANDBOX_POOL_SEED,
  SANDBOX_SWAP_AUTHORITY_SEED,
  type SandboxPool,
} from './sandbox.js';

export interface SwapRouterOptions {
  readonly rpc: Rpc<SolanaRpcApi>;
  readonly jupiterApiUrl: string;
  readonly jupiterApiKey?: string | undefined;
  readonly maxSlippageBps?: number;
  readonly maxPriceImpactBps?: number;
}

// Which router answers is a property of the cluster, not of the caller.
export function createSwapRouter(options: SwapRouterOptions): SwapRouter {
  if (clusterName() === 'mainnet') {
    return createJupiterRouter({
      apiUrl: options.jupiterApiUrl,
      apiKey: options.jupiterApiKey,
      ...(options.maxSlippageBps === undefined
        ? {}
        : { maxSlippageBps: options.maxSlippageBps }),
      ...(options.maxPriceImpactBps === undefined
        ? {}
        : { maxPriceImpactBps: options.maxPriceImpactBps }),
    });
  }
  return createSandboxRouter({ rpc: options.rpc });
}
