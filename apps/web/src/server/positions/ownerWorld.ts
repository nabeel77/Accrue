import 'server-only';

import type { Address } from '@solana/kit';

import {
  currentCluster,
  INSTRUCTIONS_SYSVAR_ADDRESS,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  KAMINO_LENDING_PROGRAM_ADDRESS,
  JUPITER_V6_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  decodeMintDecimals,
  decodeTokenAccountAmount,
} from '@accrue/solana';
import {
  findLendingMarketAuthority,
  readObligationForPosition,
  readReserve,
  reserveAccounts,
  type ObligationSnapshot,
  type ReserveAccounts,
  type ReserveReading,
} from '@accrue/solana/kamino';
import {
  fetchConfig,
  fetchMaybePosition,
  findConfigPda,
  type Config,
  type DestinationEntry,
  type Position,
} from '@accrue/solana/program';

import { chain, nowUnixTimestamp } from '../rpc.js';
import { positionAddresses } from './addresses.js';
import type { PositionAddresses } from './shape.js';

export interface OwnerWorld {
  readonly owner: Address;
  readonly at: PositionAddresses;
  readonly config: Address;
  readonly configAccount: Config;
  readonly destinationEntry: DestinationEntry;
  readonly lendingMarket: Address;
  readonly lendingMarketAuthority: Address;
  readonly collateralMint: Address;
  readonly destinationMint: Address;
  readonly usdcMint: Address;
  readonly collateralReserve: Address;
  readonly borrowReserve: Address;
  readonly collateral: ReserveReading;
  readonly borrow: ReserveReading;
  readonly collateralVaults: ReserveAccounts;
  readonly borrowVaults: ReserveAccounts;
  readonly destinationTokenProgram: Address;
}

export const THE_PROGRAMS_EVERY_CALL_NAMES = {
  farmsProgram: KAMINO_FARMS_PROGRAM_ADDRESS,
  kaminoProgram: KAMINO_LENDING_PROGRAM_ADDRESS,
  instructionSysvar: INSTRUCTIONS_SYSVAR_ADDRESS,
  swapProgram: JUPITER_V6_PROGRAM_ADDRESS,
} as const;

export function collateralReserveForMint(mint: Address): Address {
  const cluster = currentCluster();
  for (const [symbol, candidate] of Object.entries(cluster.mints)) {
    if (candidate === mint) {
      const reserve = cluster.reserves[symbol];
      if (reserve !== undefined) {
        return reserve;
      }
    }
  }
  throw new Error('that mint has no reserve on this cluster');
}

export async function resolveTheOwnerWorld(inputs: {
  readonly owner: Address;
  readonly collateralMint: Address;
  readonly destinationMint: Address;
}): Promise<OwnerWorld> {
  const cluster = currentCluster();
  const usdcMint = cluster.mints['USDC'];
  const borrowReserve = cluster.reserves['USDC'];
  if (usdcMint === undefined || borrowReserve === undefined) {
    throw new Error('this cluster is not set up');
  }
  const collateralReserve = collateralReserveForMint(inputs.collateralMint);

  const now = nowUnixTimestamp();
  const [collateral, borrow] = await Promise.all([
    readReserve(chain().rpc, collateralReserve, now),
    readReserve(chain().rpc, borrowReserve, now),
  ]);

  const [config] = await findConfigPda();
  const configAccount = (
    await fetchConfig(chain().rpc, config, { commitment: 'confirmed' })
  ).data;
  const destinationEntry = configAccount.allowedDestinations.find(
    (entry) => entry.mint === inputs.destinationMint,
  );
  if (destinationEntry === undefined) {
    throw new Error('that yield token is not on the list');
  }

  const at = await positionAddresses({
    owner: inputs.owner,
    collateralMint: inputs.collateralMint,
    collateralTokenProgram: collateral.snapshot.liquidityTokenProgram,
    borrowMint: usdcMint,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationMint: inputs.destinationMint,
    destinationTokenProgram: destinationEntry.tokenProgram,
  });

  return {
    owner: inputs.owner,
    at,
    config,
    configAccount,
    destinationEntry,
    lendingMarket: cluster.lendingMarket,
    lendingMarketAuthority: await findLendingMarketAuthority(cluster.lendingMarket),
    collateralMint: inputs.collateralMint,
    destinationMint: inputs.destinationMint,
    usdcMint,
    collateralReserve,
    borrowReserve,
    collateral,
    borrow,
    collateralVaults: reserveAccounts(collateral.snapshot),
    borrowVaults: reserveAccounts(borrow.snapshot),
    destinationTokenProgram: destinationEntry.tokenProgram,
  };
}

export async function readTheObligation(
  world: OwnerWorld,
): Promise<ObligationSnapshot | null> {
  const read = await readObligationForPosition(
    chain().rpc,
    world.at.position,
    world.lendingMarket,
  );
  return read?.snapshot ?? null;
}

// A row of ours can outlive the account it names, and an owner action on one of those has to say
// so rather than fall over reading an account that is not there.
export class ThePositionIsGone extends Error {
  constructor() {
    super('that position account is not on the chain');
    this.name = 'ThePositionIsGone';
  }
}

export async function readThePosition(world: OwnerWorld): Promise<Position> {
  const account = await fetchMaybePosition(chain().rpc, world.at.position, {
    commitment: 'confirmed',
  });
  if (!account.exists) {
    throw new ThePositionIsGone();
  }
  return account.data;
}

export async function mintDecimals(mint: Address): Promise<number> {
  const { value } = await chain()
    .rpc.getAccountInfo(mint, { encoding: 'base64', commitment: 'confirmed' })
    .send();
  if (value === null) {
    throw new Error('that mint is not on this cluster');
  }
  return decodeMintDecimals(Uint8Array.from(Buffer.from(value.data[0], 'base64')));
}

export async function tokenBalance(account: Address): Promise<bigint> {
  const { value } = await chain()
    .rpc.getAccountInfo(account, { encoding: 'base64', commitment: 'confirmed' })
    .send();
  return value === null
    ? 0n
    : decodeTokenAccountAmount(Uint8Array.from(Buffer.from(value.data[0], 'base64')));
}
