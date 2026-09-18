import type { RouteRequest, SwapRoute } from '../jupiter/route.js';

// Nobody will fill this pair at this size within the caps, which is a refusal, not a fault.
export class NoRouteFound extends Error {
  constructor(why: string) {
    super(why);
    this.name = 'NoRouteFound';
  }
}

// One swap router, whichever cluster we are on.
export interface SwapRouter {
  readonly name: string;
  findRoute(request: RouteRequest): Promise<SwapRoute>;
}
