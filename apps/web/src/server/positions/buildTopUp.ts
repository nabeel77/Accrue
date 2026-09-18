import 'server-only';

import type { Instruction } from '@solana/kit';

import {
  adjustedDebtValueScaled,
  sizeATopUp,
  usdValueOfScaled,
  type PositionNow,
} from '@accrue/core';
import { NoRouteFound, TOKEN_PROGRAM_ADDRESS } from '@accrue/solana';
import { getTopUpInstruction, PositionState } from '@accrue/solana/program';

import { collateralForMint } from '@accrue/solana';

import { CAPS } from '../env.js';
import { swapRouter } from '../rpc.js';
import { assembleAndSimulate } from './assemble.js';
import type { OwnerActionInputs } from './buildOwnerAction.js';
import {
  readTheObligation,
  readThePosition,
  resolveTheOwnerWorld,
  tokenBalance,
  THE_PROGRAMS_EVERY_CALL_NAMES,
} from './ownerWorld.js';
import { atTheLivePrice, theLivePriceOf } from './livePrice.js';
import type { BuildRefusal, BuiltTransaction } from './shape.js';
import { stepTimer, type StepTimer } from './steps.js';

const ROUTE_MAX_ACCOUNTS = 28;

function symbolOf(mint: Parameters<typeof collateralForMint>[0]): string {
  return collateralForMint(mint)?.symbol ?? '';
}
const SCALED_FRACTION_ONE = 1n << 60n;

export interface TopUpRequest extends OwnerActionInputs {
  readonly collateralAmountRaw: bigint;
}

export interface TopUpSummary {
  readonly stockSymbol: string;
  readonly collateralAmountRaw: string;
  readonly borrowUsdcRaw: string;
  readonly quotedDestinationRaw: string;
  readonly minimumDestinationRaw: string;
  readonly collateralValueAfterScaled: string;
  readonly debtValueAfterScaled: string;
  readonly loanToValueAfterBps: number;
  readonly targetLtvBps: number;
  readonly slippageBps: number;
  readonly quotedAtMilliseconds: number;
}

export type TopUpOutcome =
  | { readonly built: readonly BuiltTransaction[]; readonly summary: TopUpSummary }
  | { readonly refused: BuildRefusal };

// Growing a position the wallet already holds: the borrow comes from the value being added and
// the target the position already carries, never from anything the browser sent.
export async function buildTopUp(
  inputs: TopUpRequest,
  steps: StepTimer = stepTimer(),
): Promise<TopUpOutcome> {
  if (!CAPS.positionBuildingEnabled()) {
    return { refused: { refusal: 'paused', message: 'Position building is off.' } };
  }

  const world = await steps.at('reading the position', () =>
    resolveTheOwnerWorld(inputs),
  );
  if (world.configAccount.openPaused || world.configAccount.sunset) {
    return {
      refused: {
        refusal: 'programPaused',
        message: 'The program is not taking new borrows.',
      },
    };
  }

  const [position, obligation] = await Promise.all([
    readThePosition(world),
    readTheObligation(world),
  ]);
  if (obligation === null) {
    return {
      refused: {
        refusal: 'noLoanToGuard',
        message: 'That position is not on the market.',
      },
    };
  }
  if (position.state !== PositionState.Open) {
    return {
      refused: {
        refusal: 'strategy',
        message: 'That position is not open, so it cannot be grown.',
      },
    };
  }

  const held = await tokenBalance(world.at.ownerCollateral);
  if (held < inputs.collateralAmountRaw) {
    return {
      refused: {
        refusal: 'notEnoughStock',
        message: 'Your wallet does not hold that much of this stock.',
      },
    };
  }

  // Both sides of this are valued at the price the market will read when the transaction runs,
  // not the one its last refresh left behind.
  const livePriceScaled = await theLivePriceOf(world.collateral);
  const addedValueScaled =
    (inputs.collateralAmountRaw * livePriceScaled) /
    10n ** BigInt(world.collateral.decimals);
  // The debt comes from the amount borrowed, not from the value the market cached the last time
  // somebody refreshed this obligation: a position opened a moment ago carries a cached value of
  // nothing, and a debt read as nothing is a borrow sized as though the position owed nothing.
  const borrowedScaled = obligation.borrowedAmountScaledFor(world.borrowReserve);
  const debtValueScaled =
    borrowedScaled === 0n
      ? obligation.borrowedValueScaled
      : usdValueOfScaled(
          // Rounded up, which is against the position, as every debt is.
          (borrowedScaled + SCALED_FRACTION_ONE - 1n) / SCALED_FRACTION_ONE,
          world.borrow.decimals,
          await theLivePriceOf(world.borrow),
        );
  const now: PositionNow = {
    collateralValueScaled: atTheLivePrice(
      obligation.depositedValueScaled,
      world.collateral.oraclePriceScaled,
      livePriceScaled,
    ),
    adjustedDebtValueScaled: adjustedDebtValueScaled(
      debtValueScaled,
      world.borrow.snapshot.borrowFactorPct,
    ),
    targetLtvBps: position.strategy.targetLtvBps,
  };
  const sizing = sizeATopUp(now, addedValueScaled, true);

  const valueAfterUsd = Number(sizing.collateralValueAfterScaled / SCALED_FRACTION_ONE);
  if (valueAfterUsd > CAPS.maxPositionUsd()) {
    return {
      refused: {
        refusal: 'positionTooLarge',
        message: 'That would take the position past the largest Accrue builds.',
        detail: { maximumUsd: CAPS.maxPositionUsd() },
      },
    };
  }

  const borrowUsdc =
    (sizing.borrowValueScaled * 10n ** BigInt(world.borrow.decimals)) /
    world.borrow.oraclePriceScaled;
  if (borrowUsdc <= 0n) {
    return {
      refused: {
        refusal: 'strategy',
        message: 'This position is already at its target, so there is nothing to borrow.',
      },
    };
  }

  let route;
  try {
    route = await steps.at('quoting the yield token', () =>
      swapRouter().findRoute({
        inputMint: world.usdcMint,
        outputMint: world.destinationMint,
        amountIn: borrowUsdc,
        slippageBps: CAPS.maxSlippageBps(),
        maxAccounts: ROUTE_MAX_ACCOUNTS,
        signingAuthority: world.at.position,
      }),
    );
  } catch (failure) {
    if (!(failure instanceof NoRouteFound)) {
      throw failure;
    }
    return {
      refused: {
        refusal: 'noRoute',
        message: 'No router would fill this size.',
        detail: { amountInRaw: borrowUsdc.toString() },
      },
    };
  }
  const quotedAtMilliseconds = Date.now();

  const topUp = getTopUpInstruction({
    owner: { address: world.owner } as never,
    config: world.config,
    position: world.at.position,
    collateralMint: world.collateralMint,
    destinationMint: world.destinationMint,
    borrowMint: world.usdcMint,
    positionCollateralAccount: world.at.positionCollateral,
    positionUsdcAccount: world.at.positionUsdc,
    positionDestinationAccount: world.at.positionDestination,
    ownerCollateralAccount: world.at.ownerCollateral,
    obligation: world.at.obligation,
    lendingMarket: world.lendingMarket,
    lendingMarketAuthority: world.lendingMarketAuthority,
    collateralReserve: world.collateralReserve,
    collateralReserveLiquiditySupply: world.collateralVaults.liquiditySupply,
    collateralReserveCollateralMint: world.collateralVaults.collateralMint,
    collateralReserveCollateralSupply: world.collateralVaults.collateralSupply,
    borrowReserve: world.borrowReserve,
    borrowReserveLiquiditySupply: world.borrowVaults.liquiditySupply,
    borrowReserveFeeReceiver: world.borrowVaults.liquidityFeeReceiver,
    scopePrices: world.collateral.snapshot.scopePriceAccount,
    borrowScopePrices: world.borrow.snapshot.scopePriceAccount,
    ...THE_PROGRAMS_EVERY_CALL_NAMES,
    kaminoCollateralTokenProgram: TOKEN_PROGRAM_ADDRESS,
    collateralTokenProgram: world.collateral.snapshot.liquidityTokenProgram,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationTokenProgram: world.destinationTokenProgram,
    collateralAmount: inputs.collateralAmountRaw,
    borrowAmount: borrowUsdc,
    minimumDestinationAmount: route.minimumAmountOut,
    leaveUsdcForLaterSwap: false,
    jupiterRouteData: route.data,
  });

  const whole: Instruction = {
    ...topUp,
    accounts: [...topUp.accounts, ...route.accounts],
  };

  return {
    built: [
      await steps.at('simulating', () => assembleAndSimulate(world.owner, [whole])),
    ],
    summary: {
      stockSymbol: symbolOf(world.collateralMint),
      collateralAmountRaw: inputs.collateralAmountRaw.toString(),
      borrowUsdcRaw: borrowUsdc.toString(),
      quotedDestinationRaw: route.quote.amountOut.toString(),
      minimumDestinationRaw: route.minimumAmountOut.toString(),
      collateralValueAfterScaled: sizing.collateralValueAfterScaled.toString(),
      debtValueAfterScaled: sizing.debtValueAfterScaled.toString(),
      loanToValueAfterBps: sizing.loanToValueAfterBps,
      targetLtvBps: position.strategy.targetLtvBps,
      slippageBps: CAPS.maxSlippageBps(),
      quotedAtMilliseconds,
    },
  };
}
