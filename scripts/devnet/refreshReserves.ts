import type { Address, Instruction, KeyPairSigner } from '@solana/kit';

import { currentCluster } from '@accrue/solana';
import { getRefreshReserveInstruction } from '@accrue/solana/kamino';

import { sendInstructions, type Cluster } from './shared.js';

const COMPUTE_UNITS_A_REFRESH = 40_000;

export function everyCollateralReserve(): Address[] {
  const cluster = currentCluster();
  return Object.entries(cluster.reserves)
    .filter(([symbol]) => symbol !== 'USDC')
    .map(([, reserve]) => reserve);
}

export function refreshReserveInstructions(prices: Address): Instruction[] {
  const cluster = currentCluster();
  return Object.values(cluster.reserves).map((reserve) =>
    getRefreshReserveInstruction(
      {
        reserve,
        lendingMarket: cluster.lendingMarket,
        scopePrices: prices,
      },
      { programAddress: cluster.kaminoLendingProgram },
    ),
  );
}

export async function refreshEveryReserve(
  cluster: Cluster,
  admin: KeyPairSigner,
  prices: Address,
): Promise<string> {
  const instructions = refreshReserveInstructions(prices);
  return sendInstructions(cluster, admin, instructions, {
    computeUnitLimit: COMPUTE_UNITS_A_REFRESH * instructions.length,
  });
}
