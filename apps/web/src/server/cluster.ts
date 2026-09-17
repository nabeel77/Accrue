import 'server-only';

import { currentCluster } from '@accrue/solana';

export function currentClusterMarket(): string {
  return currentCluster().lendingMarket;
}
