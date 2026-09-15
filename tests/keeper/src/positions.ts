import type { Address } from '@solana/kit';

import {
  rawAmountWorthRoundingDown,
  SCALED_FRACTION_ONE,
  usdValueOfScaled,
} from '@accrue/core';
import {
  findKaminoObligation,
  findKaminoUserMetadata,
  findObligationFarmUserState,
  reserveAccounts,
} from '@accrue/solana/kamino';
import {
  findPositionPda,
  getBuyDestinationInstruction,
  getOpenPositionInstruction,
  getPositionDecoder,
  type Position,
  type Strategy,
} from '@accrue/solana/program';
import { TOKEN_PROGRAM_ADDRESS, routeFromSwapInstruction } from '@accrue/solana';

import { createTestRouter } from './router.js';
import { DESTINATION_DECIMALS, ONYC_SCOPE_FEED_INDEX, type World } from './world.js';

export const NVDAX_STRATEGY: Strategy = {
  targetLtvBps: 4_000,
  protectLtvBps: 5_000,
  growBelowLtvBps: 3_000,
  growEnabled: true,
  exitOnFlagEnabled: true,
};

/** The size the program's own suite opens at: twenty dollars of stock, borrowing under target. */
export const COLLATERAL_WHOLE_DOLLARS = 20n;
export const GUARDED_BORROW_AMOUNT = 7_900_000n;
export const SMALL_BORROW_AMOUNT = 4_000_000n;

const VAULT_HEADROOM_MULTIPLIER = 4n;

export interface OpenedPosition {
  readonly address: Address;
  readonly obligation: Address;
  readonly tokens: {
    readonly ownerCollateral: Address;
    readonly ownerUsdc: Address;
    readonly ownerDestination: Address;
    readonly positionCollateral: Address;
    readonly positionUsdc: Address;
    readonly positionDestination: Address;
  };
}

/** What a whole number of dollars of the stock is worth in raw units at the market's own price. */
export function stockWorthUsd(world: World, wholeDollars: bigint): bigint {
  const units = 10n ** BigInt(world.collateral.snapshot.liquidityMintDecimals);
  return (
    (wholeDollars * units * SCALED_FRACTION_ONE) /
    world.collateral.snapshot.liquidityMarketPriceScaled
  );
}

/** What the borrowed dollars buy, with a little in hand, so the position can be sold back whole. */
export function destinationWorthOf(world: World, usdcAmount: bigint): bigint {
  const fair = rawAmountWorthRoundingDown(
    usdValueOfScaled(
      usdcAmount,
      world.borrow.snapshot.liquidityMintDecimals,
      world.scopePriceScaled(world.borrow.snapshot.scopeFeedIndex),
    ),
    DESTINATION_DECIMALS,
    world.scopePriceScaled(ONYC_SCOPE_FEED_INDEX),
  );
  return (fair / 100n) * 101n;
}

export function positionAccount(world: World, position: Address): Position {
  return getPositionDecoder().decode(world.accountData(position));
}

/** Opens, then buys the destination, so the position is in the state the guard acts on. */
export async function openAGuardedPosition(
  world: World,
  borrowAmount = GUARDED_BORROW_AMOUNT,
): Promise<OpenedPosition> {
  const opened = await openAwaitingItsSwap(world, borrowAmount);
  await buyTheDestination(world, opened, borrowAmount);
  return opened;
}

async function openAwaitingItsSwap(
  world: World,
  borrowAmount: bigint,
): Promise<OpenedPosition> {
  const collateralMint = world.collateral.snapshot.liquidityMint;
  const borrowMint = world.borrow.snapshot.liquidityMint;
  const [position] = await findPositionPda({
    owner: world.owner.address,
    collateralMint,
    destinationMint: world.destinationMint,
  });
  const obligation = await findKaminoObligation({
    owner: position,
    lendingMarket: world.market,
  });

  const stockAmount = stockWorthUsd(world, COLLATERAL_WHOLE_DOLLARS);
  const tokens = await fundTheOwnerAndOpenTheTokenAccounts(world, position, stockAmount);

  const collateralVaults = reserveAccounts(world.collateral.snapshot);
  const borrowVaults = reserveAccounts(world.borrow.snapshot);
  const debtFarm = world.borrow.snapshot.debtFarm;
  if (debtFarm === null) {
    throw new Error('the borrow reserve in this snapshot carries no farm');
  }

  await world.sendExpectingSuccess(
    getOpenPositionInstruction({
      owner: world.owner,
      config: world.configAddress,
      position,
      collateralMint,
      destinationMint: world.destinationMint,
      borrowMint,
      ownerCollateralAccount: tokens.ownerCollateral,
      positionCollateralAccount: tokens.positionCollateral,
      positionUsdcAccount: tokens.positionUsdc,
      positionDestinationAccount: tokens.positionDestination,
      lendingMarket: world.market,
      lendingMarketAuthority: world.marketAuthority,
      obligation,
      userMetadata: await findKaminoUserMetadata(position),
      collateralReserve: world.collateral.address,
      collateralReserveLiquiditySupply: collateralVaults.liquiditySupply,
      collateralReserveCollateralMint: collateralVaults.collateralMint,
      collateralReserveCollateralSupply: collateralVaults.collateralSupply,
      borrowReserve: world.borrow.address,
      borrowReserveLiquiditySupply: borrowVaults.liquiditySupply,
      borrowReserveFeeReceiver: borrowVaults.liquidityFeeReceiver,
      borrowReserveFarmState: debtFarm,
      borrowObligationFarmState: await findObligationFarmUserState({
        reserveFarmState: debtFarm,
        obligation,
      }),
      scopePrices: world.scopePrices,
      collateralTokenProgram: world.collateral.snapshot.liquidityTokenProgram,
      kaminoCollateralTokenProgram: TOKEN_PROGRAM_ADDRESS,
      borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
      destinationTokenProgram: world.destinationTokenProgram,
      collateralAmount: stockAmount,
      borrowAmount,
      minimumDestinationAmount: 0n,
      strategy: NVDAX_STRATEGY,
      leaveUsdcForLaterSwap: true,
      jupiterRouteData: new Uint8Array(0),
    }),
    world.owner,
    'open_position',
  );

  return { address: position, obligation, tokens };
}

async function buyTheDestination(
  world: World,
  opened: OpenedPosition,
  usdcAmount: bigint,
): Promise<void> {
  // A little above the oracle price, so the position holds what a yield token that has grown
  // would, and selling it back covers the loan.
  const buying = destinationWorthOf(world, usdcAmount);
  const askTheRouter = createTestRouter(world, { pays: () => buying });
  const route = routeFromSwapInstruction(
    await askTheRouter({
      inputMint: world.borrow.snapshot.liquidityMint,
      outputMint: world.destinationMint,
      amountIn: usdcAmount,
      slippageBps: world.config().maxSlippageBps,
      maxAccounts: 28,
      signingAuthority: opened.address,
    }),
  );

  const instruction = getBuyDestinationInstruction({
    owner: world.owner,
    config: world.configAddress,
    position: opened.address,
    positionCollateralAccount: opened.tokens.positionCollateral,
    positionUsdcAccount: opened.tokens.positionUsdc,
    positionDestinationAccount: opened.tokens.positionDestination,
    obligation: opened.obligation,
    collateralReserve: world.collateral.address,
    minimumDestinationAmount: buying,
    jupiterRouteData: route.data,
  });

  await world.sendExpectingSuccess(
    { ...instruction, accounts: [...instruction.accounts, ...route.accounts] },
    world.owner,
    'buy_destination',
  );
}

async function fundTheOwnerAndOpenTheTokenAccounts(
  world: World,
  position: Address,
  stockAmount: bigint,
): Promise<OpenedPosition['tokens']> {
  const collateralMint = world.collateral.snapshot.liquidityMint;
  const collateralProgram = world.collateral.snapshot.liquidityTokenProgram;
  const borrowMint = world.borrow.snapshot.liquidityMint;

  const [
    ownerCollateral,
    ownerUsdc,
    ownerDestination,
    positionCollateral,
    positionUsdc,
    positionDestination,
  ] = await Promise.all([
    world.createTokenAccount({
      mint: collateralMint,
      owner: world.owner.address,
      amount: stockAmount * VAULT_HEADROOM_MULTIPLIER,
      tokenProgram: collateralProgram,
    }),
    world.createTokenAccount({
      mint: borrowMint,
      owner: world.owner.address,
      amount: 0n,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    world.createTokenAccount({
      mint: world.destinationMint,
      owner: world.owner.address,
      amount: 0n,
      tokenProgram: world.destinationTokenProgram,
    }),
    world.createTokenAccount({
      mint: collateralMint,
      owner: position,
      amount: 0n,
      tokenProgram: collateralProgram,
    }),
    world.createTokenAccount({
      mint: borrowMint,
      owner: position,
      amount: 0n,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    world.createTokenAccount({
      mint: world.destinationMint,
      owner: position,
      amount: 0n,
      tokenProgram: world.destinationTokenProgram,
    }),
  ]);

  return {
    ownerCollateral,
    ownerUsdc,
    ownerDestination,
    positionCollateral,
    positionUsdc,
    positionDestination,
  };
}
