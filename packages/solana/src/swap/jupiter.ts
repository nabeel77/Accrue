import {
  routeFromSwapInstruction,
  type RouteRequest,
  type RouteQuote,
  type SwapInstructionFromTheRouter,
  type SwapRoute,
} from '../jupiter/route.js';
import type { SwapRouter } from './router.js';

const RESTRICT_INTERMEDIATE_TOKENS = true;
const BASIS_POINTS = 10_000;

export interface JupiterRouterOptions {
  readonly apiUrl: string;
  readonly apiKey?: string | undefined;
  /** Nothing is ever asked for at more slippage than this, whatever the caller asked. */
  readonly maxSlippageBps?: number;
  /** A quote that moves the price more than this is refused rather than shown. */
  readonly maxPriceImpactBps?: number;
}

export function createJupiterRouter(options: JupiterRouterOptions): SwapRouter {
  return {
    name: 'jupiter',
    async findRoute(request: RouteRequest): Promise<SwapRoute> {
      const { instruction, quote } = await fetchSwapInstruction(options, request);
      const ceiling = options.maxPriceImpactBps;
      if (ceiling !== undefined && quote.priceImpactBps > ceiling) {
        throw new Error(
          `that route moves the price by ${quote.priceImpactBps} basis points, past the ${ceiling} allowed`,
        );
      }
      return routeFromSwapInstruction(instruction, quote);
    },
  };
}

async function fetchSwapInstruction(
  options: JupiterRouterOptions,
  request: RouteRequest,
): Promise<{ instruction: SwapInstructionFromTheRouter; quote: RouteQuote }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.apiKey !== undefined && options.apiKey !== '') {
    headers['x-api-key'] = options.apiKey;
  }

  // The caller's slippage is a request, never a raise: the ceiling here is the last word.
  const slippageBps = Math.min(
    request.slippageBps,
    options.maxSlippageBps ?? request.slippageBps,
  );
  const quoteUrl =
    `${options.apiUrl}/swap/v1/quote?inputMint=${request.inputMint}&outputMint=${request.outputMint}` +
    `&amount=${request.amountIn}&slippageBps=${slippageBps}` +
    `&restrictIntermediateTokens=${RESTRICT_INTERMEDIATE_TOKENS}&maxAccounts=${request.maxAccounts}`;

  const quoteResponse = (await fetchJson(quoteUrl, { headers })) as {
    outAmount?: string;
    priceImpactPct?: string;
  };
  if (quoteResponse.outAmount === undefined) {
    throw new Error('the router returned no quote for this pair and size');
  }
  const quote: RouteQuote = {
    amountOut: BigInt(quoteResponse.outAmount),
    priceImpactBps: Math.round(Number(quoteResponse.priceImpactPct ?? 0) * BASIS_POINTS),
  };

  const swapResponse = (await fetchJson(`${options.apiUrl}/swap/v1/swap-instructions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: request.signingAuthority,
      wrapAndUnwrapSol: false,
      useSharedAccounts: false,
      skipUserAccountsRpcCalls: true,
    }),
  })) as { swapInstruction?: SwapInstructionFromTheRouter };

  const swapInstruction = swapResponse.swapInstruction;
  if (swapInstruction === undefined) {
    throw new Error('the router returned no swap instruction for this quote');
  }
  return { instruction: swapInstruction, quote };
}

async function fetchJson(url: string, options: RequestInit): Promise<unknown> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`the router answered ${response.status}`);
  }
  return response.json();
}
