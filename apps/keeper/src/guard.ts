import type { Address, Instruction, TransactionSigner } from '@solana/kit';

import {
  addTheSlippageBuffer,
  borrowToReachTarget,
  protectAmounts,
  rawAmountWorthRoundingDown,
  rawAmountWorthRoundingUp,
  usdValueOfScaled,
} from '@accrue/core';
import {
  findAssociatedTokenAccount,
  findLendingMarketAuthority,
  findObligationFarmUserState,
  findTheThreeTokenAccounts,
  reserveAccounts,
  type ObligationSnapshot,
  type ReserveSnapshot,
} from '@accrue/solana/kamino';
import {
  getGrowInstruction,
  getLeaveInstruction,
  getProtectInstruction,
  type Config,
  type DestinationEntry,
  type Position,
} from '@accrue/solana/program';
import {
  routeFromSwapInstruction,
  TOKEN_PROGRAM_ADDRESS,
  type RouteRequest,
  type SwapInstructionFromTheRouter,
} from '@accrue/solana';

import type { Decision } from './decide.js';
import type { Candidate, GuardInstructionBuilder } from './loop.js';

/**
 * Low enough that the route's accounts plus the instruction's own keep the whole transaction
 * inside the sixty four unique addresses version one allows.
 */
export const ROUTE_MAX_ACCOUNTS = 28;

/** A permissionless call never supplies its own minimum: the program takes it from the oracle. */
const THE_PROGRAM_COMPUTES_THE_MINIMUM = 0n;

const NOTHING_TO_SWAP = new Uint8Array(0);

export interface GuardSubject {
  readonly positionAddress: Address;
  readonly position: Position;
  readonly obligation: ObligationSnapshot;
  readonly collateralReserveAddress: Address;
  readonly collateralReserve: ReserveSnapshot;
  readonly borrowReserveAddress: Address;
  readonly borrowReserve: ReserveSnapshot;
  readonly destination: DestinationEntry;
  readonly destinationDecimals: number;
  readonly destinationBalance: bigint;
  readonly usdcPriceScaled: bigint;
  readonly destinationPriceScaled: bigint;
}

export type AskTheRouter = (
  request: RouteRequest,
) => Promise<SwapInstructionFromTheRouter>;

export interface GuardAssembly {
  readonly config: Config;
  readonly configAddress: Address;
  readonly caller: TransactionSigner;
  readonly askTheRouter: AskTheRouter;
}

/**
 * The account list every guard call needs, all of it derived from the position, the two reserves
 * and the config the keeper already holds. Nothing here is an address a keeper is trusted with:
 * the program checks every one of them against the position and the reserves before it acts.
 */
export function createGuardInstructionBuilder(
  assembly: GuardAssembly,
): GuardInstructionBuilder<GuardSubject> {
  return {
    build(candidate: Candidate<GuardSubject>, decision: Decision): Promise<Instruction> {
      switch (decision.kind) {
        case 'protect':
          return buildProtect(assembly, candidate.subject);
        case 'grow':
          return buildGrow(assembly, candidate.subject);
        case 'leave':
          return buildLeave(assembly, candidate.subject);
        default:
          return Promise.reject(new Error('the guard was asked to build a wait'));
      }
    },
  };
}

/** What the guard has to sell to repay its way back to target, the program's own arithmetic. */
export function destinationToSellForProtect(
  subject: GuardSubject,
  config: Config,
): bigint {
  const usdcDecimals = subject.borrowReserve.liquidityMintDecimals;
  const amounts = protectAmounts(
    subject.obligation.borrowedValueScaled,
    subject.obligation.depositedValueScaled,
    subject.position.strategy.targetLtvBps,
    config.keeperBountyBps,
  );

  const repayNeeded = rawAmountWorthRoundingUp(
    amounts.repayUsdScaled,
    usdcDecimals,
    subject.usdcPriceScaled,
  );
  const bountyWanted = min(
    rawAmountWorthRoundingDown(
      amounts.bountyUsdScaled,
      usdcDecimals,
      subject.usdcPriceScaled,
    ),
    config.keeperBountyCapUsdc,
  );

  const atTheOraclePrice = rawAmountWorthRoundingUp(
    usdValueOfScaled(repayNeeded + bountyWanted, usdcDecimals, subject.usdcPriceScaled),
    subject.destinationDecimals,
    subject.destinationPriceScaled,
  );

  return min(
    addTheSlippageBuffer(atTheOraclePrice, config.maxSlippageBps),
    subject.destinationBalance,
  );
}

/**
 * What the guard will borrow back to reach target. The program works this out itself and never
 * reads a number from the caller, so the keeper repeats the same arithmetic only to ask the router
 * for a quote of exactly the size the program is about to spend.
 */
export function usdcToBorrowForGrow(subject: GuardSubject): bigint {
  return rawAmountWorthRoundingDown(
    borrowToReachTarget(
      subject.obligation.borrowedValueScaled,
      subject.obligation.depositedValueScaled,
      subject.position.strategy.targetLtvBps,
    ),
    subject.borrowReserve.liquidityMintDecimals,
    subject.usdcPriceScaled,
  );
}

async function buildProtect(
  assembly: GuardAssembly,
  subject: GuardSubject,
): Promise<Instruction> {
  const destinationToSell = destinationToSellForProtect(subject, assembly.config);
  if (destinationToSell === 0n) {
    throw new Error('this position has nothing left to sell');
  }

  const route = await sellingRoute(assembly, subject, destinationToSell);
  const [lendingMarketAuthority, farms, callerUsdcAccount] = await Promise.all([
    findLendingMarketAuthority(subject.position.market),
    borrowFarmAccounts(subject),
    // The bounty is paid into the caller's own account for the mint the position owes in.
    findAssociatedTokenAccount({
      owner: assembly.caller.address,
      mint: subject.borrowReserve.liquidityMint,
      tokenProgram: subject.borrowReserve.liquidityTokenProgram,
    }),
  ]);

  const instruction = getProtectInstruction({
    caller: assembly.caller,
    callerUsdcAccount,
    config: assembly.configAddress,
    position: subject.positionAddress,
    destinationMint: subject.position.destinationMint,
    borrowMint: subject.borrowReserve.liquidityMint,
    positionCollateralAccount: subject.position.collateralTokenAccount,
    positionUsdcAccount: subject.position.usdcTokenAccount,
    positionDestinationAccount: subject.position.destinationTokenAccount,
    obligation: subject.position.obligation,
    lendingMarket: subject.position.market,
    lendingMarketAuthority,
    collateralReserve: subject.collateralReserveAddress,
    borrowReserve: subject.borrowReserveAddress,
    borrowReserveLiquiditySupply: reserveAccounts(subject.borrowReserve).liquiditySupply,
    ...farms,
    collateralScopePrices: subject.collateralReserve.scopePriceAccount,
    borrowScopePrices: subject.borrowReserve.scopePriceAccount,
    destinationScopePrices: subject.destination.scopePriceAccount,
    borrowTokenProgram: subject.borrowReserve.liquidityTokenProgram,
    destinationTokenProgram: subject.destination.tokenProgram,
    ownerMinimumUsdcOut: THE_PROGRAM_COMPUTES_THE_MINIMUM,
    jupiterRouteData: route.data,
  });

  return withRouteAccounts(instruction, route.accounts);
}

async function buildGrow(
  assembly: GuardAssembly,
  subject: GuardSubject,
): Promise<Instruction> {
  const borrowing = usdcToBorrowForGrow(subject);
  if (borrowing === 0n) {
    throw new Error('this position has no room left to borrow');
  }

  const route = await buyingRoute(assembly, subject, borrowing);
  const [lendingMarketAuthority, farms] = await Promise.all([
    findLendingMarketAuthority(subject.position.market),
    borrowFarmAccounts(subject),
  ]);
  const borrowVaults = reserveAccounts(subject.borrowReserve);

  const instruction = getGrowInstruction({
    caller: assembly.caller,
    config: assembly.configAddress,
    position: subject.positionAddress,
    destinationMint: subject.position.destinationMint,
    borrowMint: subject.borrowReserve.liquidityMint,
    positionCollateralAccount: subject.position.collateralTokenAccount,
    positionUsdcAccount: subject.position.usdcTokenAccount,
    positionDestinationAccount: subject.position.destinationTokenAccount,
    obligation: subject.position.obligation,
    lendingMarket: subject.position.market,
    lendingMarketAuthority,
    collateralReserve: subject.collateralReserveAddress,
    borrowReserve: subject.borrowReserveAddress,
    borrowReserveLiquiditySupply: borrowVaults.liquiditySupply,
    borrowReserveFeeReceiver: borrowVaults.liquidityFeeReceiver,
    ...farms,
    collateralScopePrices: subject.collateralReserve.scopePriceAccount,
    borrowScopePrices: subject.borrowReserve.scopePriceAccount,
    destinationScopePrices: subject.destination.scopePriceAccount,
    borrowTokenProgram: subject.borrowReserve.liquidityTokenProgram,
    destinationTokenProgram: subject.destination.tokenProgram,
    ownerMinimumDestinationOut: THE_PROGRAM_COMPUTES_THE_MINIMUM,
    jupiterRouteData: route.data,
  });

  return withRouteAccounts(instruction, route.accounts);
}

async function buildLeave(
  assembly: GuardAssembly,
  subject: GuardSubject,
): Promise<Instruction> {
  // Leaving sells whatever the position still holds. With nothing to sell there is no route.
  const route =
    subject.destinationBalance > 0n
      ? await sellingRoute(assembly, subject, subject.destinationBalance)
      : { accounts: [], data: NOTHING_TO_SWAP };

  const [lendingMarketAuthority, collateralFarms, borrowFarms, ownerAccounts] =
    await Promise.all([
      findLendingMarketAuthority(subject.position.market),
      collateralFarmAccounts(subject),
      borrowFarmAccounts(subject),
      findTheThreeTokenAccounts(subject.position.owner, {
        collateral: {
          mint: subject.position.collateralMint,
          tokenProgram: subject.collateralReserve.liquidityTokenProgram,
        },
        usdc: {
          mint: subject.borrowReserve.liquidityMint,
          tokenProgram: subject.borrowReserve.liquidityTokenProgram,
        },
        destination: {
          mint: subject.position.destinationMint,
          tokenProgram: subject.destination.tokenProgram,
        },
      }),
    ]);

  const collateralVaults = reserveAccounts(subject.collateralReserve);

  const instruction = getLeaveInstruction({
    caller: assembly.caller,
    config: assembly.configAddress,
    position: subject.positionAddress,
    collateralMint: subject.position.collateralMint,
    destinationMint: subject.position.destinationMint,
    borrowMint: subject.borrowReserve.liquidityMint,
    positionCollateralAccount: subject.position.collateralTokenAccount,
    positionUsdcAccount: subject.position.usdcTokenAccount,
    positionDestinationAccount: subject.position.destinationTokenAccount,
    ownerCollateralAccount: ownerAccounts.collateral,
    ownerUsdcAccount: ownerAccounts.usdc,
    ownerDestinationAccount: ownerAccounts.destination,
    owner: subject.position.owner,
    obligation: subject.position.obligation,
    lendingMarket: subject.position.market,
    lendingMarketAuthority,
    collateralReserve: subject.collateralReserveAddress,
    collateralReserveCollateralSupply: collateralVaults.collateralSupply,
    collateralReserveCollateralMint: collateralVaults.collateralMint,
    collateralReserveLiquiditySupply: collateralVaults.liquiditySupply,
    borrowReserve: subject.borrowReserveAddress,
    borrowReserveLiquiditySupply: reserveAccounts(subject.borrowReserve).liquiditySupply,
    ...collateralFarms,
    ...borrowFarms,
    collateralScopePrices: subject.collateralReserve.scopePriceAccount,
    borrowScopePrices: subject.borrowReserve.scopePriceAccount,
    destinationScopePrices: subject.destination.scopePriceAccount,
    kaminoCollateralTokenProgram: TOKEN_PROGRAM_ADDRESS,
    collateralTokenProgram: subject.collateralReserve.liquidityTokenProgram,
    borrowTokenProgram: subject.borrowReserve.liquidityTokenProgram,
    destinationTokenProgram: subject.destination.tokenProgram,
    jupiterRouteData: route.data,
  });

  return withRouteAccounts(instruction, route.accounts);
}

async function sellingRoute(
  assembly: GuardAssembly,
  subject: GuardSubject,
  amountIn: bigint,
) {
  return routeFromSwapInstruction(
    await assembly.askTheRouter({
      inputMint: subject.position.destinationMint,
      outputMint: subject.borrowReserve.liquidityMint,
      amountIn,
      slippageBps: assembly.config.maxSlippageBps,
      maxAccounts: ROUTE_MAX_ACCOUNTS,
      signingAuthority: subject.positionAddress,
    }),
  );
}

async function buyingRoute(
  assembly: GuardAssembly,
  subject: GuardSubject,
  amountIn: bigint,
) {
  return routeFromSwapInstruction(
    await assembly.askTheRouter({
      inputMint: subject.borrowReserve.liquidityMint,
      outputMint: subject.position.destinationMint,
      amountIn,
      slippageBps: assembly.config.maxSlippageBps,
      maxAccounts: ROUTE_MAX_ACCOUNTS,
      signingAuthority: subject.positionAddress,
    }),
  );
}

async function borrowFarmAccounts(subject: GuardSubject): Promise<{
  borrowReserveFarmState?: Address;
  borrowObligationFarmState?: Address;
}> {
  const farm = subject.borrowReserve.debtFarm;
  if (farm === null) {
    return {};
  }
  return {
    borrowReserveFarmState: farm,
    borrowObligationFarmState: await findObligationFarmUserState({
      reserveFarmState: farm,
      obligation: subject.position.obligation,
    }),
  };
}

async function collateralFarmAccounts(subject: GuardSubject): Promise<{
  collateralReserveFarmState?: Address;
  collateralObligationFarmState?: Address;
}> {
  const farm = subject.collateralReserve.collateralFarm;
  if (farm === null) {
    return {};
  }
  return {
    collateralReserveFarmState: farm,
    collateralObligationFarmState: await findObligationFarmUserState({
      reserveFarmState: farm,
      obligation: subject.position.obligation,
    }),
  };
}

function withRouteAccounts(
  instruction: Instruction,
  routeAccounts: Instruction['accounts'],
): Instruction {
  if (routeAccounts === undefined || routeAccounts.length === 0) {
    return instruction;
  }
  return {
    ...instruction,
    accounts: [...(instruction.accounts ?? []), ...routeAccounts],
  };
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
