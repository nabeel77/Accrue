import 'server-only';

import type { Address, Instruction } from '@solana/kit';

import {
  adjustedDebtValueScaled,
  destinationToSellForProtect,
  STRATEGY_REFUSAL_MESSAGES,
  thePriceIsTooOld,
  whyTheStrategyIsRefused,
  type StrategyLevels,
} from '@accrue/core';
import { NoRouteFound, TOKEN_PROGRAM_ADDRESS } from '@accrue/solana';
import { readScopePrice } from '@accrue/solana/kamino';
import {
  getAddCollateralInstruction,
  getClosePositionInstruction,
  getProtectInstruction,
  getRepayInstruction,
  getSetStrategyInstruction,
  getUnwindInstruction,
} from '@accrue/solana/program';

import { CAPS } from '../env.js';
import { chain, swapRouter } from '../rpc.js';
import { assemble, assembleAndSimulate, TransactionDoesNotFit } from './assemble.js';
import { stepTimer, type StepTimer } from './steps.js';
import {
  mintDecimals,
  readTheObligation,
  readThePosition,
  resolveTheOwnerWorld,
  tokenBalance,
  THE_PROGRAMS_EVERY_CALL_NAMES,
  type OwnerWorld,
} from './ownerWorld.js';
import type { BuildRefusal, BuiltTransaction } from './shape.js';

const ROUTE_MAX_ACCOUNTS = 28;
// The program repays the smaller of what is asked for and what is owed, so this asks for all of it.
const REPAY_EVERYTHING = 2n ** 64n - 1n;

export interface OwnerActionInputs {
  readonly owner: Address;
  readonly collateralMint: Address;
  readonly destinationMint: Address;
}

export type OwnerActionOutcome =
  { readonly built: readonly BuiltTransaction[] } | { readonly refused: BuildRefusal };

function closePosition(world: OwnerWorld): Instruction {
  return getClosePositionInstruction({
    owner: { address: world.owner } as never,
    position: world.at.position,
    positionCollateralAccount: world.at.positionCollateral,
    positionUsdcAccount: world.at.positionUsdc,
    positionDestinationAccount: world.at.positionDestination,
    obligation: world.at.obligation,
    collateralReserve: world.collateralReserve,
    collateralTokenProgram: world.collateral.snapshot.liquidityTokenProgram,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationTokenProgram: world.destinationTokenProgram,
  });
}

// Closing is the sale, the repayment and the account going away in one signature.
export async function buildUnwindAndClose(
  inputs: OwnerActionInputs,
  steps: StepTimer = stepTimer(),
): Promise<OwnerActionOutcome> {
  const { world, destinationHeld } = await steps.at('reading the position', async () => {
    const read = await resolveTheOwnerWorld(inputs);
    return {
      world: read,
      destinationHeld: await tokenBalance(read.at.positionDestination),
    };
  });
  if (destinationHeld === 0n) {
    return {
      refused: {
        refusal: 'nothingToSell',
        message: 'This position holds no yield token to sell.',
      },
    };
  }

  const withdrawals = world.collateral.caps.withdrawals;
  const deposited = await tokenBalance(world.at.positionCollateral);
  if (withdrawals.isCapped && withdrawals.remaining < deposited) {
    return {
      refused: {
        refusal: 'capExhausted',
        message: 'The market has no withdrawal room left for this stock.',
        detail: {
          remainingRaw: withdrawals.remaining.toString(),
          neededRaw: deposited.toString(),
          resetsAt: withdrawals.windowResetsAt.toString(),
        },
      },
    };
  }

  let route;
  try {
    route = await steps.at('quoting the exit', () =>
      swapRouter().findRoute({
        inputMint: world.destinationMint,
        outputMint: world.usdcMint,
        amountIn: destinationHeld,
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
        message: 'No router would fill the exit at this size.',
        detail: { amountInRaw: destinationHeld.toString() },
      },
    };
  }

  const unwind = await steps.at('building', () =>
    Promise.resolve(
      getUnwindInstruction({
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
        ownerUsdcAccount: world.at.ownerUsdc,
        ownerDestinationAccount: world.at.ownerDestination,
        treasuryUsdcAccount: world.configAccount.treasury,
        obligation: world.at.obligation,
        lendingMarket: world.lendingMarket,
        lendingMarketAuthority: world.lendingMarketAuthority,
        collateralReserve: world.collateralReserve,
        collateralReserveCollateralSupply: world.collateralVaults.collateralSupply,
        collateralReserveCollateralMint: world.collateralVaults.collateralMint,
        collateralReserveLiquiditySupply: world.collateralVaults.liquiditySupply,
        borrowReserve: world.borrowReserve,
        borrowReserveLiquiditySupply: world.borrowVaults.liquiditySupply,
        collateralScopePrices: world.collateral.snapshot.scopePriceAccount,
        borrowScopePrices: world.borrow.snapshot.scopePriceAccount,
        collateralTokenProgram: world.collateral.snapshot.liquidityTokenProgram,
        borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
        destinationTokenProgram: world.destinationTokenProgram,
        ...THE_PROGRAMS_EVERY_CALL_NAMES,
        minimumUsdcOut: route.minimumAmountOut,
        jupiterRouteData: route.data,
      }),
    ),
  );

  const whole: Instruction = {
    ...unwind,
    accounts: [...unwind.accounts, ...route.accounts],
  };

  // The pair fits over the table on most clusters. Where it does not, the sale goes first and
  // the account is closed by the next one, and the page signs both.
  return steps.at('simulating', async () => {
    try {
      return {
        built: [await assembleAndSimulate(world.owner, [whole, closePosition(world)])],
      };
    } catch (failure) {
      if (!(failure instanceof TransactionDoesNotFit)) {
        throw failure;
      }
    }
    return {
      built: [
        await assembleAndSimulate(world.owner, [whole]),
        await assemble(world.owner, [closePosition(world)]),
      ],
    };
  });
}

// Repaying what leave left outstanding and closing the account, in one signature.
export async function buildRepayAndClose(
  inputs: OwnerActionInputs,
): Promise<OwnerActionOutcome> {
  const world = await resolveTheOwnerWorld(inputs);
  return {
    built: [
      await assembleAndSimulate(world.owner, [
        repayInstruction(world, REPAY_EVERYTHING),
        closePosition(world),
      ]),
    ],
  };
}

export async function buildRepay(
  inputs: OwnerActionInputs & { readonly requestedAmountRaw: bigint },
): Promise<OwnerActionOutcome> {
  const world = await resolveTheOwnerWorld(inputs);
  return {
    built: [
      await assembleAndSimulate(world.owner, [
        repayInstruction(world, inputs.requestedAmountRaw),
      ]),
    ],
  };
}

function repayInstruction(world: OwnerWorld, requestedAmount: bigint): Instruction {
  return getRepayInstruction({
    owner: { address: world.owner } as never,
    position: world.at.position,
    borrowMint: world.usdcMint,
    positionCollateralAccount: world.at.positionCollateral,
    positionUsdcAccount: world.at.positionUsdc,
    positionDestinationAccount: world.at.positionDestination,
    ownerUsdcAccount: world.at.ownerUsdc,
    obligation: world.at.obligation,
    lendingMarket: world.lendingMarket,
    lendingMarketAuthority: world.lendingMarketAuthority,
    collateralReserve: world.collateralReserve,
    borrowReserve: world.borrowReserve,
    borrowReserveLiquiditySupply: world.borrowVaults.liquiditySupply,
    collateralScopePrices: world.collateral.snapshot.scopePriceAccount,
    borrowScopePrices: world.borrow.snapshot.scopePriceAccount,
    farmsProgram: THE_PROGRAMS_EVERY_CALL_NAMES.farmsProgram,
    kaminoProgram: THE_PROGRAMS_EVERY_CALL_NAMES.kaminoProgram,
    instructionSysvar: THE_PROGRAMS_EVERY_CALL_NAMES.instructionSysvar,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    requestedAmount,
  });
}

export async function buildAddCollateral(
  inputs: OwnerActionInputs & { readonly collateralAmountRaw: bigint },
): Promise<OwnerActionOutcome> {
  const world = await resolveTheOwnerWorld(inputs);
  const held = await tokenBalance(world.at.ownerCollateral);
  if (held < inputs.collateralAmountRaw) {
    return {
      refused: {
        refusal: 'notEnoughStock',
        message: 'Your wallet does not hold that much of this stock.',
      },
    };
  }

  const instruction = getAddCollateralInstruction({
    owner: { address: world.owner } as never,
    position: world.at.position,
    collateralMint: world.collateralMint,
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
    scopePrices: world.collateral.snapshot.scopePriceAccount,
    borrowScopePrices: world.borrow.snapshot.scopePriceAccount,
    collateralTokenProgram: world.collateral.snapshot.liquidityTokenProgram,
    farmsProgram: THE_PROGRAMS_EVERY_CALL_NAMES.farmsProgram,
    kaminoProgram: THE_PROGRAMS_EVERY_CALL_NAMES.kaminoProgram,
    instructionSysvar: THE_PROGRAMS_EVERY_CALL_NAMES.instructionSysvar,
    collateralAmount: inputs.collateralAmountRaw,
  });
  return { built: [await assembleAndSimulate(world.owner, [instruction])] };
}

export async function buildSetStrategy(
  inputs: OwnerActionInputs & {
    readonly strategy: StrategyLevels & {
      readonly growEnabled: boolean;
      readonly exitOnFlagEnabled: boolean;
    };
  },
): Promise<OwnerActionOutcome> {
  const world = await resolveTheOwnerWorld(inputs);
  const refusal = whyTheStrategyIsRefused(
    inputs.strategy,
    world.collateral.maxLoanToValueBps,
    world.collateral.liquidationThresholdBps,
  );
  if (refusal !== null) {
    return {
      refused: {
        refusal: 'guardLevelsOutOfBounds',
        message: STRATEGY_REFUSAL_MESSAGES[refusal],
        detail: { why: STRATEGY_REFUSAL_MESSAGES[refusal] },
      },
    };
  }

  const instruction = getSetStrategyInstruction({
    owner: { address: world.owner } as never,
    position: world.at.position,
    positionCollateralAccount: world.at.positionCollateral,
    positionUsdcAccount: world.at.positionUsdc,
    positionDestinationAccount: world.at.positionDestination,
    obligation: world.at.obligation,
    collateralReserve: world.collateralReserve,
    strategy: {
      targetLtvBps: inputs.strategy.targetLtvBps,
      protectLtvBps: inputs.strategy.protectLtvBps,
      growBelowLtvBps: inputs.strategy.growBelowLtvBps,
      growEnabled: inputs.strategy.growEnabled,
      exitOnFlagEnabled: inputs.strategy.exitOnFlagEnabled,
    },
  });
  return { built: [await assembleAndSimulate(world.owner, [instruction])] };
}

export async function buildProtectByOwner(
  inputs: OwnerActionInputs,
): Promise<OwnerActionOutcome> {
  const world = await resolveTheOwnerWorld(inputs);
  const [usdcPrice, destinationPrice] = await Promise.all([
    readScopePrice(
      chain().rpc,
      world.borrow.snapshot.scopePriceAccount,
      world.borrow.snapshot.scopeFeedIndex,
    ),
    readScopePrice(
      chain().rpc,
      world.destinationEntry.scopePriceAccount,
      world.destinationEntry.scopeFeedIndex,
    ),
  ]);

  const maxPriceAgeSlots = world.configAccount.maxPriceAgeSlots;
  if (
    thePriceIsTooOld(usdcPrice.ageInSlots, maxPriceAgeSlots) ||
    thePriceIsTooOld(destinationPrice.ageInSlots, maxPriceAgeSlots)
  ) {
    return {
      refused: {
        refusal: 'staleOracle',
        message: 'The oracle price the guard reads is older than the program allows.',
        detail: {
          usdcAgeInSlots: usdcPrice.ageInSlots.toString(),
          destinationAgeInSlots: destinationPrice.ageInSlots.toString(),
          maxPriceAgeSlots: maxPriceAgeSlots.toString(),
        },
      },
    };
  }

  const [obligation, position, destinationDecimals, destinationHeld] = await Promise.all([
    readTheObligation(world),
    readThePosition(world),
    mintDecimals(world.destinationMint),
    tokenBalance(world.at.positionDestination),
  ]);
  if (obligation === null) {
    return {
      refused: {
        refusal: 'noLoanToGuard',
        message: 'That position has no loan to guard.',
      },
    };
  }

  // The market only refreshes those figures when it is called, so they are worked out here from
  // the amounts and prices it is holding now.
  const depositedValueScaled =
    (obligation.depositedAmountFor(world.collateralReserve) *
      world.collateral.oraclePriceScaled) /
    10n ** BigInt(world.collateral.decimals);
  const debtRaw = obligation.borrowedAmountScaledFor(world.borrowReserve) / (1n << 60n);
  const debtValueScaled =
    (debtRaw * world.borrow.oraclePriceScaled) / 10n ** BigInt(world.borrow.decimals);

  const destinationToSell = destinationToSellForProtect({
    adjustedDebtValueScaled: adjustedDebtValueScaled(
      debtValueScaled,
      world.borrow.snapshot.borrowFactorPct,
    ),
    depositedValueScaled,
    targetLtvBps: position.strategy.targetLtvBps,
    borrowFactorPct: world.borrow.snapshot.borrowFactorPct,
    keeperBountyBps: world.configAccount.keeperBountyBps,
    keeperBountyCapUsdc: world.configAccount.keeperBountyCapUsdc,
    maxSlippageBps: world.configAccount.maxSlippageBps,
    usdcDecimals: world.borrow.decimals,
    usdcPriceScaled: usdPerWholeToken(usdcPrice.price),
    destinationDecimals,
    destinationPriceScaled: usdPerWholeToken(destinationPrice.price),
    destinationBalance: destinationHeld,
  });

  if (destinationToSell === 0n) {
    return {
      refused: {
        refusal: 'nothingToSell',
        message: 'This position has nothing left to sell.',
        detail: {
          heldRaw: destinationHeld.toString(),
          depositedValueScaled: depositedValueScaled.toString(),
          debtRaw: debtRaw.toString(),
          targetLtvBps: position.strategy.targetLtvBps,
          borrowFactorPct: world.borrow.snapshot.borrowFactorPct,
        },
      },
    };
  }

  let route;
  try {
    route = await swapRouter().findRoute({
      inputMint: world.destinationMint,
      outputMint: world.usdcMint,
      amountIn: destinationToSell,
      slippageBps: CAPS.maxSlippageBps(),
      maxAccounts: ROUTE_MAX_ACCOUNTS,
      signingAuthority: world.at.position,
    });
  } catch (failure) {
    if (!(failure instanceof NoRouteFound)) {
      throw failure;
    }
    return {
      refused: {
        refusal: 'noRoute',
        message: 'No router would fill the guard sale at this size.',
        detail: { amountInRaw: destinationToSell.toString() },
      },
    };
  }

  const protect = getProtectInstruction({
    caller: { address: world.owner } as never,
    callerUsdcAccount: world.at.ownerUsdc,
    config: world.config,
    position: world.at.position,
    destinationMint: world.destinationMint,
    borrowMint: world.usdcMint,
    positionCollateralAccount: world.at.positionCollateral,
    positionUsdcAccount: world.at.positionUsdc,
    positionDestinationAccount: world.at.positionDestination,
    obligation: world.at.obligation,
    lendingMarket: world.lendingMarket,
    lendingMarketAuthority: world.lendingMarketAuthority,
    collateralReserve: world.collateralReserve,
    borrowReserve: world.borrowReserve,
    borrowReserveLiquiditySupply: world.borrowVaults.liquiditySupply,
    collateralScopePrices: world.collateral.snapshot.scopePriceAccount,
    borrowScopePrices: world.borrow.snapshot.scopePriceAccount,
    destinationScopePrices: world.destinationEntry.scopePriceAccount,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationTokenProgram: world.destinationTokenProgram,
    ...THE_PROGRAMS_EVERY_CALL_NAMES,
    ownerMinimumUsdcOut: route.minimumAmountOut,
    jupiterRouteData: route.data,
  });

  const whole: Instruction = {
    ...protect,
    accounts: [...protect.accounts, ...route.accounts],
  };
  return { built: [await assembleAndSimulate(world.owner, [whole])] };
}

function usdPerWholeToken(price: { value: bigint; exponent: bigint }): bigint {
  const one = 1n << 60n;
  return (price.value * one) / 10n ** price.exponent;
}
