import 'server-only';

import { address, type Address, type Instruction } from '@solana/kit';

import { currentCluster, TOKEN_PROGRAM_ADDRESS } from '@accrue/solana';
import {
  findLendingMarketAuthority,
  readReserve,
  reserveAccounts,
} from '@accrue/solana/kamino';
import { findConfigPda, getRepayInstruction } from '@accrue/solana/program';

import {
  INSTRUCTIONS_SYSVAR_ADDRESS,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  KAMINO_LENDING_PROGRAM_ADDRESS,
} from '@accrue/solana';

import { chain, nowUnixTimestamp } from '../rpc.js';
import { positionAddresses } from './addresses.js';
import { assembleAndSimulate } from './assemble.js';
import type { BuiltTransaction } from './shape.js';

export interface RepayInputs {
  readonly owner: Address;
  readonly collateralMint: Address;
  readonly destinationMint: Address;
  readonly collateralReserve: Address;
  readonly requestedAmountRaw: bigint;
}

/** Repay from the owner's own wallet. Works while paused, by design. */
export async function buildRepay(inputs: RepayInputs): Promise<BuiltTransaction> {
  const cluster = currentCluster();
  const usdcReserve = cluster.reserves['USDC'];
  const usdcMint = cluster.mints['USDC'];
  if (usdcReserve === undefined || usdcMint === undefined) {
    throw new Error('this cluster is not set up');
  }
  const now = nowUnixTimestamp();
  const [collateral, borrow] = await Promise.all([
    readReserve(chain().rpc, inputs.collateralReserve, now),
    readReserve(chain().rpc, usdcReserve, now),
  ]);
  const at = await positionAddresses({
    owner: inputs.owner,
    collateralMint: inputs.collateralMint,
    collateralTokenProgram: collateral.snapshot.liquidityTokenProgram,
    borrowMint: usdcMint,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationMint: inputs.destinationMint,
    destinationTokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const borrowVaults = reserveAccounts(borrow.snapshot);

  const instruction: Instruction = getRepayInstruction({
    owner: { address: inputs.owner } as never,
    position: at.position,
    borrowMint: usdcMint,
    positionCollateralAccount: at.positionCollateral,
    positionUsdcAccount: at.positionUsdc,
    positionDestinationAccount: at.positionDestination,
    ownerUsdcAccount: at.ownerUsdc,
    obligation: at.obligation,
    lendingMarket: cluster.lendingMarket,
    lendingMarketAuthority: await findLendingMarketAuthority(cluster.lendingMarket),
    collateralReserve: inputs.collateralReserve,
    borrowReserve: usdcReserve,
    borrowReserveLiquiditySupply: borrowVaults.liquiditySupply,
    collateralScopePrices: collateral.snapshot.scopePriceAccount,
    borrowScopePrices: borrow.snapshot.scopePriceAccount,
    farmsProgram: KAMINO_FARMS_PROGRAM_ADDRESS,
    kaminoProgram: KAMINO_LENDING_PROGRAM_ADDRESS,
    instructionSysvar: INSTRUCTIONS_SYSVAR_ADDRESS,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    requestedAmount: inputs.requestedAmountRaw,
  });

  await findConfigPda();
  return assembleAndSimulate(inputs.owner, [instruction]);
}

export { address };
