import { DEVNET } from './devnet.js';
import { LOCALNET } from './localnet.js';
import { MAINNET } from './mainnet.js';
import type { ClusterAddresses, ClusterName } from './shape.js';

export type { ClusterAddresses, ClusterName } from './shape.js';
export { DEVNET } from './devnet.js';
export { LOCALNET } from './localnet.js';
export { MAINNET } from './mainnet.js';

const BY_NAME: Readonly<Record<ClusterName, ClusterAddresses>> = {
  mainnet: MAINNET,
  devnet: DEVNET,
  localnet: LOCALNET,
};

export function clusterName(): ClusterName {
  const chosen = process.env['SOLANA_CLUSTER'];
  if (chosen === undefined || chosen === '') {
    return 'mainnet';
  }
  if (chosen !== 'mainnet' && chosen !== 'devnet' && chosen !== 'localnet') {
    throw new Error(
      `SOLANA_CLUSTER is ${chosen}, which is not mainnet, devnet or localnet`,
    );
  }
  return chosen;
}

export function currentCluster(): ClusterAddresses {
  return BY_NAME[clusterName()];
}
