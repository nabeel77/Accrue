import { shownDestinations } from '@accrue/core';

import { isDevnet } from '../../../server/env.js';
import { quoteTheExit } from '../../../server/exit.js';
import {
  destinationOnThisCluster,
  thePositionSizeLimits,
} from '../../../server/markets.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';
import { latestDestinationTarget } from '../../../server/snapshots.js';

export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  const limit = await withinTheLimit('read', 'destinations', wallet ?? 'anonymous');
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }

  const shown = shownDestinations();
  const limits = await thePositionSizeLimits();
  const withTargets = await Promise.all(
    shown.map(async (destination) => {
      const [target, exit] = await Promise.all([
        latestDestinationTarget(destination),
        quoteTheExit(destination, limits.largestUsd),
      ]);
      return {
        symbol: destination.symbol,
        name: destination.name,
        mint: destinationOnThisCluster(destination) ?? destination.mainnetMint,
        decimals: destination.decimals,
        yieldSource: destination.yieldSource,
        exitType: destination.exitType,
        targetRateBps: target.rateBps,
        targetRateSource: target.source,
        targetRateReadAtMilliseconds: target.readAtMilliseconds,
        exit,
      };
    }),
  );
  return ok({
    readAt: new Date().toISOString(),
    largestPositionUsd: limits.largestUsd,
    priceSource: isDevnet() ? 'test-router' : 'jupiter',
    destinations: withTargets,
  });
}
