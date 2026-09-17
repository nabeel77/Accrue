import type { RouteRequest, SwapRoute } from '../jupiter/route.js';

/**
 * One swap router, whichever cluster we are on. Nothing above this interface knows whether the
 * fill came from the live aggregator or from the sandbox program, and nothing below it decides
 * anything about money: the program computes its own floor from the oracle either way.
 */
export interface SwapRouter {
  readonly name: string;
  findRoute(request: RouteRequest): Promise<SwapRoute>;
}
