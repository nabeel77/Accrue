import 'server-only';

import { shortenEveryAddress, type Destination } from '@accrue/core';
import { currentCluster } from '@accrue/solana';
import { findConfigPda } from '@accrue/solana/program';

import { CAPS } from './env.js';
import { swapRouter } from './rpc.js';

const USDC_DECIMALS = 6;
const ROUTE_MAX_ACCOUNTS = 28;

export interface ExitQuote {
  readonly sellableTodayUsdcRaw: string;
  readonly slippageBps: number;
  readonly quotedAtMilliseconds: number;
  // What one USDC buys of the yield token at the size that was quoted, for the deposit screen.
  readonly destinationPerUsdc: number;
}

export interface BuyQuote {
  // What one USDC buys of the yield token at the size that was quoted.
  readonly destinationPerUsdc: number;
  readonly quotedAtMilliseconds: number;
}

// One leg only: what the borrowed USDC buys of the yield token, for the figure the deposit
// screen shows before anything is signed.
export async function quoteTheBuy(
  destination: Destination,
  borrowUsd: number,
): Promise<BuyQuote | null> {
  const cluster = currentCluster();
  const usdcMint = cluster.mints['USDC'];
  const destinationMint = cluster.mints[destination.symbol];
  const amountIn = BigInt(Math.round(borrowUsd * 10 ** USDC_DECIMALS));
  if (usdcMint === undefined || destinationMint === undefined || amountIn <= 0n) {
    return null;
  }
  const [signingAuthority] = await findConfigPda();
  try {
    const bought = await swapRouter().findRoute({
      inputMint: usdcMint,
      outputMint: destinationMint,
      amountIn,
      slippageBps: CAPS.maxSlippageBps(),
      maxAccounts: ROUTE_MAX_ACCOUNTS,
      signingAuthority,
    });
    return {
      destinationPerUsdc:
        Number(bought.quote.amountOut) / 10 ** destination.decimals / borrowUsd,
      quotedAtMilliseconds: Date.now(),
    };
  } catch (failure) {
    const why = failure instanceof Error ? failure.message : 'no reason given';
    console.error(shortenEveryAddress(`no buy quote for ${destination.symbol}: ${why}`));
    return null;
  }
}

// The round trip a real exit makes: the largest position's USDC into the yield token, then that
// holding sold back. What comes back is what can be sold today inside the slippage cap.
export async function quoteTheExit(
  destination: Destination,
  largestPositionUsd: number,
): Promise<ExitQuote | null> {
  const cluster = currentCluster();
  const usdcMint = cluster.mints['USDC'];
  const destinationMint = cluster.mints[destination.symbol];
  const probeUsdcRaw = BigInt(Math.round(largestPositionUsd * 10 ** USDC_DECIMALS));
  if (usdcMint === undefined || destinationMint === undefined || probeUsdcRaw <= 0n) {
    return null;
  }

  const slippageBps = CAPS.maxSlippageBps();
  const [signingAuthority] = await findConfigPda();
  const router = swapRouter();
  try {
    const bought = await router.findRoute({
      inputMint: usdcMint,
      outputMint: destinationMint,
      amountIn: probeUsdcRaw,
      slippageBps,
      maxAccounts: ROUTE_MAX_ACCOUNTS,
      signingAuthority,
    });
    const sold = await router.findRoute({
      inputMint: destinationMint,
      outputMint: usdcMint,
      amountIn: bought.quote.amountOut,
      slippageBps,
      maxAccounts: ROUTE_MAX_ACCOUNTS,
      signingAuthority,
    });
    const boughtWhole = Number(bought.quote.amountOut) / 10 ** destination.decimals;
    return {
      sellableTodayUsdcRaw: sold.quote.amountOut.toString(),
      slippageBps,
      quotedAtMilliseconds: Date.now(),
      destinationPerUsdc: boughtWhole / largestPositionUsd,
    };
  } catch (failure) {
    // No quote is a fact about the destination, not an error for the reader, but it is logged.
    const why = failure instanceof Error ? failure.message : 'no reason given';
    console.error(shortenEveryAddress(`no exit quote for ${destination.symbol}: ${why}`));
    return null;
  }
}
