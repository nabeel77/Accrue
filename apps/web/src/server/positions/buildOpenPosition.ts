import 'server-only';

import { address, type Address, type Instruction } from '@solana/kit';
import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token-2022';

import {
  CURRENT_RISK_ACKNOWLEDGEMENT_VERSION,
  CURRENT_TERMS_VERSION,
  defaultStrategyFor,
  valuedForBorrowing,
  type Destination,
} from '@accrue/core';
import {
  currentCluster,
  collateralForMint,
  decodeScaledUiAmountMultiplier,
  INSTRUCTIONS_SYSVAR_ADDRESS,
  JUPITER_V6_PROGRAM_ADDRESS,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  KAMINO_LENDING_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from '@accrue/solana';
import {
  findKaminoUserMetadata,
  findLendingMarketAuthority,
  readReserve,
  reserveAccounts,
} from '@accrue/solana/kamino';
import {
  fetchConfig,
  findConfigPda,
  getBuyDestinationInstruction,
  getOpenPositionInstruction,
} from '@accrue/solana/program';

import { CAPS } from '../env.js';
import { standingOf } from '../gates.js';
import { chain, nowUnixTimestamp, swapRouter } from '../rpc.js';
import { positionAddresses } from './addresses.js';
import { theLivePriceOf } from './livePrice.js';
import { assemble, assembleAndSimulate, TransactionDoesNotFit } from './assemble.js';
import { recordThePositionRow } from './record.js';
import type { BuildRefusal, BuiltTransaction } from './shape.js';

const BASIS_POINTS = 10_000n;
const SCALED_FRACTION_ONE = 1n << 60n;
const A_SLOT_IN_MILLISECONDS = 400;
const ROUTE_MAX_ACCOUNTS = 28;

export interface OpenRequest {
  readonly wallet: string;
  readonly stockMint: string;
  readonly destinationSymbol: string;
  readonly collateralAmountRaw: string;
  readonly targetLtvBps?: number | undefined;
  readonly protectLtvBps?: number | undefined;
  readonly growEnabled?: boolean | undefined;
  readonly exitOnFlagEnabled?: boolean | undefined;
  readonly overrideAccepted?: boolean | undefined;
}

export type OpenOutcome =
  | {
      readonly built: readonly BuiltTransaction[];
      readonly summary: OpenSummary;
      readonly positionId: string | null;
    }
  | { readonly refused: BuildRefusal };

export interface OpenSummary {
  readonly stockSymbol: string;
  readonly collateralAmountRaw: string;
  readonly collateralUsdScaled: string;
  readonly borrowUsdcRaw: string;
  readonly borrowRateBps: number;
  readonly destinationSymbol: string;
  readonly quotedDestinationRaw: string;
  readonly minimumDestinationRaw: string;
  readonly destinationTargetRateBps: number;
  readonly maxLoanToValueBps: number;
  readonly liquidationThresholdBps: number;
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
  readonly oraclePriceScaled: string;
  readonly collateralDecimals: number;
  readonly slippageBps: number;
  readonly positionAddress: string;
  readonly quotedAtMilliseconds: number;
}

// The order matters: the terms, then the acknowledgement, then the caps.
interface TokenAccountWanted {
  readonly account: Address;
  readonly mint: Address;
  readonly tokenProgram: Address;
  readonly owner?: Address;
}

async function multiplierOfTheMint(mint: Address): Promise<number> {
  const { value } = await chain()
    .rpc.getAccountInfo(mint, { encoding: 'base64', commitment: 'confirmed' })
    .send();
  return value === null
    ? 1
    : decodeScaledUiAmountMultiplier(
        Uint8Array.from(Buffer.from(value.data[0], 'base64')),
      );
}

// A blockhash dies at a block height, so the row records when that height is due to arrive.
async function whenTheBlockhashDies(built: readonly BuiltTransaction[]): Promise<Date> {
  const lastGood = BigInt(built[0]?.blockhashExpiresAtHeight ?? '0');
  const now = await chain().rpc.getBlockHeight().send();
  const blocksLeft = lastGood > now ? Number(lastGood - now) : 0;
  return new Date(Date.now() + blocksLeft * A_SLOT_IN_MILLISECONDS);
}

async function theTokenAccountsToCreate(
  payer: Address,
  wanted: readonly TokenAccountWanted[],
  position: Address,
): Promise<Instruction[]> {
  const { value } = await chain()
    .rpc.getMultipleAccounts(
      wanted.map((entry) => entry.account),
      { encoding: 'base64', commitment: 'confirmed' },
    )
    .send();

  return wanted.flatMap((entry, index) =>
    value[index] == null
      ? [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: { address: payer } as never,
            ata: entry.account,
            owner: entry.owner ?? position,
            mint: entry.mint,
            tokenProgram: entry.tokenProgram,
          }) as Instruction,
        ]
      : [],
  );
}

async function theTransactionsThatFit(
  owner: Address,
  paths: readonly (readonly Instruction[][])[],
): Promise<readonly BuiltTransaction[]> {
  let lastRefusal: Error | null = null;
  for (const path of paths) {
    try {
      const built: BuiltTransaction[] = [];
      for (const [index, instructions] of path.entries()) {
        built.push(
          index === 0
            ? await assembleAndSimulate(owner, instructions)
            : await assemble(owner, instructions),
        );
      }
      return built;
    } catch (failure) {
      if (!(failure instanceof TransactionDoesNotFit)) {
        throw failure;
      }
      lastRefusal = failure;
    }
  }
  throw lastRefusal ?? new Error('no transaction path fits this endpoint');
}

export async function buildOpenPosition(
  input: OpenRequest,
  destination: Destination,
  destinationTargetRateBps: number,
): Promise<OpenOutcome> {
  const standing = await standingOf(input.wallet);
  if (!standing.termsAccepted) {
    return {
      refused: {
        refusal: 'terms',
        message: 'Accept the terms before building a position.',
        detail: { version: CURRENT_TERMS_VERSION },
      },
    };
  }
  if (!standing.risksAcknowledged) {
    return {
      refused: {
        refusal: 'acknowledgement',
        message: 'Take the risk acknowledgement before your first position.',
        detail: { version: CURRENT_RISK_ACKNOWLEDGEMENT_VERSION },
      },
    };
  }
  if (!CAPS.positionBuildingEnabled()) {
    return { refused: { refusal: 'paused', message: 'Position building is off.' } };
  }

  const [config] = await findConfigPda();
  const configAccount = await fetchConfig(chain().rpc, config, {
    commitment: 'confirmed',
  });
  if (configAccount.data.openPaused || configAccount.data.sunset) {
    return {
      refused: {
        refusal: 'programPaused',
        message: 'The program is not taking new positions.',
      },
    };
  }

  const stock = collateralForMint(address(input.stockMint));
  if (stock === null) {
    return {
      refused: { refusal: 'stockNotOffered', message: 'That stock is not on the list.' },
    };
  }
  const cluster = currentCluster();
  const usdcReserveAddress = cluster.reserves['USDC'];
  const usdcMint = cluster.mints['USDC'];
  const destinationMint = cluster.mints[destination.symbol];
  if (
    usdcReserveAddress === undefined ||
    usdcMint === undefined ||
    destinationMint === undefined
  ) {
    return {
      refused: {
        refusal: 'pairNotOnThisNetwork',
        message: 'This cluster is not set up.',
      },
    };
  }

  const now = nowUnixTimestamp();
  const [collateral, borrow] = await Promise.all([
    readReserve(chain().rpc, stock.reserve, now),
    readReserve(chain().rpc, usdcReserveAddress, now),
  ]);

  const strategyDefaults = defaultStrategyFor(collateral.maxLoanToValueBps);
  const targetLtvBps = input.targetLtvBps ?? strategyDefaults.targetLtvBps;
  const protectLtvBps = input.protectLtvBps ?? strategyDefaults.protectLtvBps;

  if (targetLtvBps > strategyDefaults.targetLtvBps && input.overrideAccepted !== true) {
    return {
      refused: {
        refusal: 'aboveTheDefaultLoanToValue',
        message: 'That is above the default loan to value.',
        detail: {
          defaultLtvBps: strategyDefaults.targetLtvBps,
          requestedLtvBps: targetLtvBps,
          maxLtvBps: collateral.maxLoanToValueBps,
        },
      },
    };
  }
  if (targetLtvBps > collateral.maxLoanToValueBps) {
    return {
      refused: {
        refusal: 'aboveTheMarketMaximum',
        message: 'That is above what the market allows.',
      },
    };
  }

  const collateralAmount = BigInt(input.collateralAmountRaw);
  const collateralPriceScaled = await theLivePriceOf(collateral);
  const collateralUsdScaled =
    (collateralAmount * collateralPriceScaled) / 10n ** BigInt(collateral.decimals);
  const collateralUsd = Number(collateralUsdScaled) / Number(1n << 60n);
  if (collateralUsd < CAPS.minPositionUsd()) {
    return {
      refused: {
        refusal: 'positionTooSmall',
        message: `The smallest position is ${CAPS.minPositionUsd()} dollars.`,
        detail: { valueUsd: collateralUsd, minimumUsd: CAPS.minPositionUsd() },
      },
    };
  }
  if (collateralUsd > CAPS.maxPositionUsd()) {
    return {
      refused: {
        refusal: 'positionTooLarge',
        message: `The largest position is ${CAPS.maxPositionUsd()} dollars.`,
        detail: { valueUsd: collateralUsd, maximumUsd: CAPS.maxPositionUsd() },
      },
    };
  }

  const borrowUsdc =
    (valuedForBorrowing(collateralUsdScaled) *
      BigInt(targetLtvBps) *
      10n ** BigInt(borrow.decimals)) /
    BASIS_POINTS /
    (1n << 60n);

  const shareCeiling =
    (borrow.availableLiquidity *
      BigInt(Math.round(CAPS.maxShareOfAvailableLiquidity() * 10_000))) /
    BASIS_POINTS;
  if (borrowUsdc > shareCeiling) {
    return {
      refused: {
        refusal: 'aboveTheLiquidityShare',
        message: 'That borrow is too big a share of what is left.',
        detail: {
          requestedRaw: borrowUsdc.toString(),
          maxBorrowRaw: shareCeiling.toString(),
          availableRaw: borrow.availableLiquidity.toString(),
          maxSharePercent: CAPS.maxShareOfAvailableLiquidity() * 100,
        },
      },
    };
  }

  const owner = address(input.wallet);
  const addresses = await positionAddresses({
    owner,
    collateralMint: stock.mint,
    collateralTokenProgram: collateral.snapshot.liquidityTokenProgram,
    borrowMint: usdcMint,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationMint,
    destinationTokenProgram:
      destination.tokenProgram === 'token2022'
        ? address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
        : TOKEN_PROGRAM_ADDRESS,
  });

  const positionAccountOnChain = await chain()
    .rpc.getAccountInfo(addresses.position, {
      encoding: 'base64',
      commitment: 'confirmed',
    })
    .send();
  if (positionAccountOnChain.value !== null) {
    return {
      refused: {
        refusal: 'positionAlreadyOpen',
        message: `You already have a position in ${stock.symbol} earning ${destination.symbol}. Close it before opening another.`,
        detail: { stock: stock.symbol, destination: destination.symbol },
      },
    };
  }

  const route = await swapRouter().findRoute({
    inputMint: usdcMint,
    outputMint: destinationMint,
    amountIn: borrowUsdc,
    slippageBps: CAPS.maxSlippageBps(),
    maxAccounts: ROUTE_MAX_ACCOUNTS,
    signingAuthority: addresses.position,
  });
  const quotedAtMilliseconds = Date.now();

  const collateralVaults = reserveAccounts(collateral.snapshot);
  const borrowVaults = reserveAccounts(borrow.snapshot);
  const marketAuthority = await findLendingMarketAuthority(cluster.lendingMarket);
  const userMetadata = await findKaminoUserMetadata(addresses.position);
  const destinationTokenProgram =
    destination.tokenProgram === 'token2022'
      ? address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
      : TOKEN_PROGRAM_ADDRESS;

  const openPosition = (withTheSwap: boolean): Instruction => {
    const open = getOpenPositionInstruction({
      owner: { address: owner } as never,
      config,
      position: addresses.position,
      collateralMint: stock.mint,
      destinationMint,
      borrowMint: usdcMint,
      ownerCollateralAccount: addresses.ownerCollateral,
      positionCollateralAccount: addresses.positionCollateral,
      positionUsdcAccount: addresses.positionUsdc,
      positionDestinationAccount: addresses.positionDestination,
      lendingMarket: cluster.lendingMarket,
      lendingMarketAuthority: marketAuthority,
      obligation: addresses.obligation,
      userMetadata,
      collateralReserve: stock.reserve,
      collateralReserveLiquiditySupply: collateralVaults.liquiditySupply,
      collateralReserveCollateralMint: collateralVaults.collateralMint,
      collateralReserveCollateralSupply: collateralVaults.collateralSupply,
      borrowReserve: usdcReserveAddress,
      borrowReserveLiquiditySupply: borrowVaults.liquiditySupply,
      borrowReserveFeeReceiver: borrowVaults.liquidityFeeReceiver,
      scopePrices: collateral.snapshot.scopePriceAccount,
      collateralTokenProgram: collateral.snapshot.liquidityTokenProgram,
      kaminoCollateralTokenProgram: TOKEN_PROGRAM_ADDRESS,
      borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
      destinationTokenProgram,
      farmsProgram: KAMINO_FARMS_PROGRAM_ADDRESS,
      kaminoProgram: KAMINO_LENDING_PROGRAM_ADDRESS,
      instructionSysvar: INSTRUCTIONS_SYSVAR_ADDRESS,
      swapProgram: JUPITER_V6_PROGRAM_ADDRESS,
      collateralAmount,
      borrowAmount: borrowUsdc,
      minimumDestinationAmount: withTheSwap ? route.minimumAmountOut : 0n,
      strategy: {
        targetLtvBps,
        protectLtvBps,
        growBelowLtvBps: strategyDefaults.growBelowLtvBps,
        growEnabled: input.growEnabled ?? false,
        exitOnFlagEnabled: input.exitOnFlagEnabled ?? true,
      },
      leaveUsdcForLaterSwap: !withTheSwap,
      jupiterRouteData: withTheSwap ? route.data : new Uint8Array(0),
    });
    return withTheSwap
      ? { ...open, accounts: [...open.accounts, ...route.accounts] }
      : open;
  };

  const buyTheDestination = (): Instruction => {
    const buy = getBuyDestinationInstruction({
      owner: { address: owner } as never,
      config,
      position: addresses.position,
      positionCollateralAccount: addresses.positionCollateral,
      positionUsdcAccount: addresses.positionUsdc,
      positionDestinationAccount: addresses.positionDestination,
      obligation: addresses.obligation,
      collateralReserve: stock.reserve,
      swapProgram: JUPITER_V6_PROGRAM_ADDRESS,
      minimumDestinationAmount: route.minimumAmountOut,
      jupiterRouteData: route.data,
    });
    return { ...buy, accounts: [...buy.accounts, ...route.accounts] };
  };

  const creates = await theTokenAccountsToCreate(
    owner,
    [
      {
        account: addresses.positionCollateral,
        mint: stock.mint,
        tokenProgram: collateral.snapshot.liquidityTokenProgram,
      },
      {
        account: addresses.positionUsdc,
        mint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      },
      {
        account: addresses.positionDestination,
        mint: destinationMint,
        tokenProgram: destinationTokenProgram,
      },
      {
        account: addresses.ownerUsdc,
        mint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        owner,
      },
      {
        account: addresses.ownerDestination,
        mint: destinationMint,
        tokenProgram: destinationTokenProgram,
        owner,
      },
    ],
    addresses.position,
  );

  const built = await theTransactionsThatFit(owner, [
    [[...creates, openPosition(true)]],
    [[...creates, openPosition(false)], [buyTheDestination()]],
    ...(creates.length === 0
      ? []
      : [[creates, [openPosition(false)], [buyTheDestination()]]]),
  ]);

  const scaledToWhole = (scaled: bigint): number =>
    Number(scaled) / Number(SCALED_FRACTION_ONE);
  const oraclePrice = scaledToWhole(collateral.oraclePriceScaled);
  const liquidationPriceAtOpen =
    collateral.liquidationThresholdBps === 0
      ? 0
      : (oraclePrice * targetLtvBps) / collateral.liquidationThresholdBps;

  return {
    built,
    positionId: await recordThePositionRow({
      walletAddress: input.wallet,
      positionAddress: addresses.position,
      marketAddress: cluster.lendingMarket,
      obligationAddress: addresses.obligation,
      targetLtvBps,
      protectLtvBps,
      growBelowLtvBps: strategyDefaults.growBelowLtvBps,
      growEnabled: input.growEnabled ?? false,
      exitOnFlagEnabled: input.exitOnFlagEnabled ?? true,
      feeBpsAtOpen: configAccount.data.performanceFeeBps,
      collateralMint: stock.mint,
      collateralDecimals: collateral.decimals,
      collateralAmountRaw: collateralAmount.toString(),
      collateralMultiplierAtOpen: (await multiplierOfTheMint(stock.mint)).toFixed(6),
      collateralPriceAtOpen: oraclePrice.toFixed(6),
      borrowMint: usdcMint,
      borrowAmountRaw: borrowUsdc.toString(),
      borrowApyAtOpen: (borrow.borrowRateBps / 100).toFixed(6),
      destinationMint,
      destinationAmountRaw: route.quote.amountOut.toString(),
      destinationApyAtOpen: (destinationTargetRateBps / 100).toFixed(6),
      ltvAtOpen: (targetLtvBps / 100).toFixed(6),
      maxLtvAtOpen: (collateral.maxLoanToValueBps / 100).toFixed(6),
      liquidationThresholdAtOpen: (collateral.liquidationThresholdBps / 100).toFixed(6),
      liquidationPriceAtOpen: liquidationPriceAtOpen.toFixed(6),
      ltvOverrideAccepted: input.overrideAccepted ?? false,
      blockhashExpiresAt: await whenTheBlockhashDies(built),
    }),
    summary: {
      stockSymbol: stock.symbol,
      collateralAmountRaw: collateralAmount.toString(),
      collateralUsdScaled: collateralUsdScaled.toString(),
      borrowUsdcRaw: borrowUsdc.toString(),
      borrowRateBps: borrow.borrowRateBps,
      destinationSymbol: destination.symbol,
      quotedDestinationRaw: route.quote.amountOut.toString(),
      minimumDestinationRaw: route.minimumAmountOut.toString(),
      destinationTargetRateBps,
      maxLoanToValueBps: collateral.maxLoanToValueBps,
      liquidationThresholdBps: collateral.liquidationThresholdBps,
      targetLtvBps,
      protectLtvBps,
      growBelowLtvBps: strategyDefaults.growBelowLtvBps,
      oraclePriceScaled: collateral.oraclePriceScaled.toString(),
      collateralDecimals: collateral.decimals,
      slippageBps: CAPS.maxSlippageBps(),
      positionAddress: addresses.position,
      quotedAtMilliseconds,
    },
  };
}

export type { Address };
