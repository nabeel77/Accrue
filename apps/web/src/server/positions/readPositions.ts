import 'server-only';

import { address, type Address } from '@solana/kit';

import { fallToLiquidationBps, readHealth, usdcNeededToClose } from '@accrue/core';
import { currentCluster, decodeTokenAccountAmount } from '@accrue/solana';
import {
  readObligationForPosition,
  readReserve,
  type ObligationSnapshot,
} from '@accrue/solana/kamino';
import { fetchPosition, type Position } from '@accrue/solana/program';

import { CAPS } from '../env.js';
import { chain, nowUnixTimestamp, swapRouter } from '../rpc.js';

const SCALED_FRACTION_ONE = 1n << 60n;
const ROUTE_MAX_ACCOUNTS = 28;

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
  readonly loanToValueBps: number;
  readonly protectLtvBps: number;
  readonly targetLtvBps: number;
  readonly liquidationThresholdBps: number;
  readonly healthZone: string;
  readonly fillBps: number;
  readonly distanceToLiquidationBps: number;
  readonly fallToLiquidationBps: number;
  readonly debtRaw: string;
  /** Read live from the obligation. Only when that read fails does the account's own figure show. */
  readonly debtIsLive: boolean;
  readonly owedAtLeaveRaw: string;
  readonly collateralRaw: string;
  readonly destinationRaw: string;
  readonly oraclePriceScaled: string;
  readonly collateralDecimals: number;
  readonly borrowRateBps: number;
  readonly lastProtectAt: string;
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
    account = await fetchPosition(chain().rpc, positionAddress);
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

  // The obligation only carries a loan to value from the last time the market refreshed it, so
  // this one is worked out from the amounts and the prices the market itself is holding now.
  const collateralValueScaled =
    (depositedAmount * collateral.oraclePriceScaled) / 10n ** BigInt(collateral.decimals);
  const debtValueScaled =
    borrow === null
      ? 0n
      : (debtRaw * borrow.oraclePriceScaled) / 10n ** BigInt(borrow.decimals);
  const loanToValueBps =
    collateralValueScaled === 0n
      ? 0
      : Number((debtValueScaled * 10_000n) / collateralValueScaled);
  const health = readHealth(
    loanToValueBps,
    position.strategy.protectLtvBps,
    collateral.liquidationThresholdBps,
  );

  return {
    address: positionAddress,
    state: stateName(position.state),
    stockSymbol: '',
    collateralMint: position.collateralMint,
    destinationMint: position.destinationMint,
    loanToValueBps,
    protectLtvBps: position.strategy.protectLtvBps,
    targetLtvBps: position.strategy.targetLtvBps,
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
    oraclePriceScaled: collateral.oraclePriceScaled.toString(),
    collateralDecimals: collateral.decimals,
    borrowRateBps: borrow?.borrowRateBps ?? 0,
    lastProtectAt: position.lastProtectAt.toString(),
    protectCount: position.protectCount,
    growCount: position.growCount,
  };
}

/** Zero when the account is gone, which is what a closed position leaves behind. */
async function balanceOf(tokenAccount: Address): Promise<bigint> {
  try {
    const { value } = await chain()
      .rpc.getAccountInfo(tokenAccount, { encoding: 'base64' })
      .send();
    return value === null
      ? 0n
      : decodeTokenAccountAmount(Uint8Array.from(Buffer.from(value.data[0], 'base64')));
  } catch {
    return 0n;
  }
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
  readonly neededFromTheWalletRaw: string;
  readonly quotedUsdcOutRaw: string;
  readonly debtRaw: string;
}

/** What the closing sheet shows beside the sentence from the risks doc. */
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

  let quoted = 0n;
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
    quoted = 0n;
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
