import { shownDestinations } from '@accrue/core';

import { destinationOnThisCluster } from '../../../server/markets.js';
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
  const withTargets = await Promise.all(
    shown.map(async (destination) => {
      const target = await latestDestinationTarget(destination);
      return {
        symbol: destination.symbol,
        name: destination.name,
        mint: destinationOnThisCluster(destination) ?? destination.mainnetMint,
        decimals: destination.decimals,
        yieldSource: destination.yieldSource,
        exitType: destination.exitType,
        targetRateBps: target.rateBps,
        targetRateSource: target.source,
      };
    }),
  );
  return ok({ readAt: new Date().toISOString(), destinations: withTargets });
}
