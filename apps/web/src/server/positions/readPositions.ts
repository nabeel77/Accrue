import 'server-only';

import { address, type Address } from '@solana/kit';

import {
  adjustedDebtValueScaled,
  DESTINATIONS,
  fallToLiquidationBps,
  netYieldBps,
  loanToValueBps as loanToValueFromCore,
  readHealth,
  thePriceIsTooOld,
  usdcNeededToClose,
  usdPerWholeTokenScaled,
} from '@accrue/core';
import {
  collateralForMint,
  currentCluster,
  decodeTokenAccountAmount,
  TOKEN_PROGRAM_ADDRESS,
} from '@accrue/solana';
import {
  findAssociatedTokenAccount,
  readObligationForPosition,
  readReserve,
  readScopePrice,
  type ObligationSnapshot,
  type ReserveReading,
} from '@accrue/solana/kamino';
import {
  fetchConfig,
  fetchPosition,
  findConfigPda,
  type Position,
} from '@accrue/solana/program';

import { CAPS } from '../env.js';
import { priceOfTheDestinationMint } from '../markets.js';
import { latestDestinationTarget } from '../snapshots.js';
import { chain, nowUnixTimestamp, swapRouter } from '../rpc.js';

const SCALED_FRACTION_ONE = 1n << 60n;
const ROUTE_MAX_ACCOUNTS = 28;
const A_SLOT_IN_MILLISECONDS = 400;
const USDC_DECIMALS = 6;
const MILLISECONDS_IN_A_SECOND = 1_000;

export type PositionStateName = 'AwaitingSwap' | 'Open' | 'Closing' | 'Closed';
const STATE_NAMES: readonly PositionStateName[] = [
  'AwaitingSwap',
  'Open',
  'Closing',
  'Closed',
];

export interface PositionReading {
  readonly address: string;
  readonly state: PositionStateName;
  readonly stockSymbol: string;
  readonly collateralMint: string;
  readonly destinationMint: string;
  readonly destinationSymbol: string;
  readonly destinationDecimals: number;
  readonly destinationRateBps: number;
  readonly netYieldBps: number;
  readonly collateralValueScaled: string;
  readonly loanToValueBps: number;
  readonly protectLtvBps: number;
  readonly targetLtvBps: number;
  readonly growBelowLtvBps: number;
  readonly growEnabled: boolean;
  readonly liquidationThresholdBps: number;
  readonly healthZone: string;
  readonly fillBps: number;
  readonly distanceToLiquidationBps: number;
  readonly fallToLiquidationBps: number;
  readonly debtRaw: string;
  // Read live from the obligation.
  readonly debtIsLive: boolean;
  readonly owedAtLeaveRaw: string;
  readonly collateralRaw: string;
  readonly destinationRaw: string;
  readonly destinationValueUsd: number;
  readonly earnedUsd: number;
  readonly oraclePriceScaled: string;
  readonly oraclePriceAgeSeconds: number;
  readonly oraclePriceIsTooOld: boolean;
  readonly collateralDecimals: number;
  readonly borrowDecimals: number;
  // What the owner's own wallet holds, so a sheet can offer a figure it can actually use.
  readonly ownerBorrowBalanceRaw: string;
  readonly ownerCollateralBalanceRaw: string;
  readonly borrowRateBps: number;
  readonly lastProtectAt: string;
  readonly protectIntervalSeconds: number;
  readonly protectCount: number;
  readonly growCount: number;
}

function stateName(state: number): PositionStateName {
  return STATE_NAMES[state] ?? 'Closed';
}

export async function readOnePosition(
  positionAddress: Address,
): Promise<PositionReading | null> {
  const cluster = currentCluster();
  let account: { data: Position };
  try {
    account = await fetchPosition(chain().rpc, positionAddress, {
      commitment: 'confirmed',
    });
  } catch {
    return null;
  }
  const position = account.data;

  const now = nowUnixTimestamp();
  const collateral = await readReserve(
    chain().rpc,
    collateralReserveFor(position.collateralMint),
    now,
  );
  const borrowReserve = cluster.reserves['USDC'];
  const borrow =
    borrowReserve === undefined
      ? null
      : await readReserve(chain().rpc, borrowReserve, now);

  const priceAge = await howOldTheOraclePriceIs(collateral);

  let obligation: ObligationSnapshot | null = null;
  try {
    const read = await readObligationForPosition(
      chain().rpc,
      positionAddress,
      cluster.lendingMarket,
    );
    obligation = read?.snapshot ?? null;
  } catch {
    obligation = null;
  }

  const debtFromTheMarket =
    obligation === null
      ? null
      : obligation.borrowedAmountScaledFor(collateralReserveFor(position.borrowMint)) /
        SCALED_FRACTION_ONE;
  const debtRaw = debtFromTheMarket ?? position.usdcOwedAtLeave;
  const depositedAmount =
    obligation?.depositedAmountFor(collateralReserveFor(position.collateralMint)) ?? 0n;
  const destinationRaw = await balanceOf(position.destinationTokenAccount);
  const [ownerBorrowBalanceRaw, ownerCollateralBalanceRaw] = await Promise.all([
    balanceOf(
      await findAssociatedTokenAccount({
        owner: position.owner,
        mint: position.borrowMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
    ),
    balanceOf(
      await findAssociatedTokenAccount({
        owner: position.owner,
        mint: position.collateralMint,
        tokenProgram: collateral.snapshot.liquidityTokenProgram,
      }),
    ),
  ]);

  // The obligation only carries a loan to value from the last time the market refreshed it, so
  // this one is worked out from the amounts and the prices the market itself is holding now.
  const collateralValueScaled =
    (depositedAmount * priceAge.scaled) / 10n ** BigInt(collateral.decimals);
  const debtValueScaled =
    borrow === null
      ? 0n
      : (debtRaw * borrow.oraclePriceScaled) / 10n ** BigInt(borrow.decimals);
  const loanToValueBps = loanToValueFromCore(
    adjustedDebtValueScaled(debtValueScaled, borrow?.snapshot.borrowFactorPct ?? 100),
    collateralValueScaled,
  );
  const destination =
    DESTINATIONS.find(
      (entry) => cluster.mints[entry.symbol] === position.destinationMint,
    ) ?? null;
  const destinationRateBps =
    destination === null ? 0 : (await latestDestinationTarget(destination)).rateBps;
  const destinationValueUsd =
    destination === null
      ? 0
      : (Number(destinationRaw) / 10 ** destination.decimals) *
        (await priceOfTheDestinationMint(position.destinationMint));

  const health = readHealth(
    loanToValueBps,
    position.strategy.protectLtvBps,
    collateral.liquidationThresholdBps,
  );

  return {
    address: positionAddress,
    state: stateName(position.state),
    stockSymbol: symbolForMint(position.collateralMint),
    collateralMint: position.collateralMint,
    destinationMint: position.destinationMint,
    destinationSymbol: destination?.symbol ?? '',
    destinationDecimals: destination?.decimals ?? 0,
    destinationRateBps,
    netYieldBps: netYieldBps(
      position.strategy.targetLtvBps,
      destinationRateBps,
      borrow?.borrowRateBps ?? 0,
    ),
    collateralValueScaled: collateralValueScaled.toString(),
    loanToValueBps,
    protectLtvBps: position.strategy.protectLtvBps,
    targetLtvBps: position.strategy.targetLtvBps,
    growBelowLtvBps: position.strategy.growBelowLtvBps,
    growEnabled: position.strategy.growEnabled,
    liquidationThresholdBps: collateral.liquidationThresholdBps,
    healthZone: health.zone,
    fillBps: health.fillBps,
    distanceToLiquidationBps: health.distanceToLiquidationBps,
    fallToLiquidationBps: fallToLiquidationBps(
      loanToValueBps,
      collateral.liquidationThresholdBps,
    ),
    debtRaw: debtRaw.toString(),
    debtIsLive: debtFromTheMarket !== null,
    owedAtLeaveRaw: position.usdcOwedAtLeave.toString(),
    collateralRaw: depositedAmount.toString(),
    destinationRaw: destinationRaw.toString(),
    destinationValueUsd,
    earnedUsd:
      destinationValueUsd - Number(debtRaw) / 10 ** (borrow?.decimals ?? USDC_DECIMALS),
    oraclePriceScaled: priceAge.scaled.toString(),
    oraclePriceAgeSeconds: priceAge.seconds,
    oraclePriceIsTooOld: priceAge.tooOld,
    collateralDecimals: collateral.decimals,
    borrowDecimals: borrow?.decimals ?? USDC_DECIMALS,
    ownerBorrowBalanceRaw: ownerBorrowBalanceRaw.toString(),
    ownerCollateralBalanceRaw: ownerCollateralBalanceRaw.toString(),
    borrowRateBps: borrow?.borrowRateBps ?? 0,
    lastProtectAt: position.lastProtectAt.toString(),
    protectIntervalSeconds: priceAge.protectIntervalSeconds,
    protectCount: position.protectCount,
    growCount: position.growCount,
  };
}

// The age of the price the market values this collateral at, against the age the program allows.
async function howOldTheOraclePriceIs(collateral: ReserveReading): Promise<{
  seconds: number;
  tooOld: boolean;
  scaled: bigint;
  protectIntervalSeconds: number;
}> {
  try {
    const [configAddress] = await findConfigPda();
    const [price, config] = await Promise.all([
      readScopePrice(
        chain().rpc,
        collateral.snapshot.scopePriceAccount,
        collateral.snapshot.scopeFeedIndex,
      ),
      fetchConfig(chain().rpc, configAddress, { commitment: 'confirmed' }),
    ]);
    return {
      seconds: Math.round(
        (Number(price.ageInSlots) * A_SLOT_IN_MILLISECONDS) / MILLISECONDS_IN_A_SECOND,
      ),
      tooOld: thePriceIsTooOld(price.ageInSlots, config.data.maxPriceAgeSlots),
      scaled: usdPerWholeTokenScaled(price.price),
      protectIntervalSeconds: Number(config.data.minProtectIntervalSeconds),
    };
  } catch {
    return {
      seconds: 0,
      tooOld: false,
      scaled: collateral.oraclePriceScaled,
      protectIntervalSeconds: 0,
    };
  }
}

// Zero when the account is gone, which is what a closed position leaves behind.
async function balanceOf(tokenAccount: Address): Promise<bigint> {
  try {
    const { value } = await chain()
      .rpc.getAccountInfo(tokenAccount, { encoding: 'base64', commitment: 'confirmed' })
      .send();
    return value === null
      ? 0n
      : decodeTokenAccountAmount(Uint8Array.from(Buffer.from(value.data[0], 'base64')));
  } catch {
    return 0n;
  }
}

function symbolForMint(mint: Address): string {
  const cluster = currentCluster();
  for (const [symbol, candidate] of Object.entries(cluster.mints)) {
    if (candidate === mint) {
      return symbol;
    }
  }
  return collateralForMint(mint)?.symbol ?? '';
}

function collateralReserveFor(mint: Address): Address {
  const cluster = currentCluster();
  for (const [symbol, candidate] of Object.entries(cluster.mints)) {
    if (candidate === mint) {
      const reserve = cluster.reserves[symbol];
      if (reserve !== undefined) {
        return reserve;
      }
    }
  }
  return address(mint);
}

export interface ClosingEstimate {
  // Null when no quote came back, so the sheet shows a dash rather than a number.
  readonly neededFromTheWalletRaw: string | null;
  readonly quotedUsdcOutRaw: string | null;
  readonly debtRaw: string;
}

// What the closing sheet shows beside the sentence from the risks doc.
export async function estimateWhatClosingNeeds(
  reading: PositionReading,
  destinationHeldRaw: bigint,
  feeBpsAtOpen: number,
): Promise<ClosingEstimate> {
  const cluster = currentCluster();
  const usdcMint = cluster.mints['USDC'];
  const debt = BigInt(reading.debtRaw);
  if (usdcMint === undefined || destinationHeldRaw === 0n) {
    return {
      neededFromTheWalletRaw: debt.toString(),
      quotedUsdcOutRaw: '0',
      debtRaw: debt.toString(),
    };
  }

  let quoted: bigint | null = null;
  try {
    const route = await swapRouter().findRoute({
      inputMint: address(reading.destinationMint),
      outputMint: usdcMint,
      amountIn: destinationHeldRaw,
      slippageBps: CAPS.maxSlippageBps(),
      maxAccounts: ROUTE_MAX_ACCOUNTS,
      signingAuthority: address(reading.address),
    });
    quoted = route.quote.amountOut;
  } catch {
    quoted = null;
  }

  // No quote is not the same as a quote of nothing, so the sheet is told it has no estimate.
  if (quoted === null) {
    return {
      neededFromTheWalletRaw: null,
      quotedUsdcOutRaw: null,
      debtRaw: debt.toString(),
    };
  }

  return {
    neededFromTheWalletRaw: usdcNeededToClose({
      debt,
      quotedUsdcOut: quoted,
      feeBpsAtOpen,
      borrowRateBps: reading.borrowRateBps,
    }).toString(),
    quotedUsdcOutRaw: quoted.toString(),
    debtRaw: debt.toString(),
  };
}
