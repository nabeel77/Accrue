import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';

import { decodeMintDecimals, decodeTokenAccountAmount } from '@accrue/solana';
import { decodeScopePrice } from '@accrue/solana/kamino';
import type { Config } from '@accrue/solana/program';

import type { GuardLimits } from './decide.js';
import type { GuardSubject } from './guard.js';
import type { Candidate, Round } from './loop.js';
import { readTheMarketAfterARefresh } from './market.js';
import { loadOpenPositions } from './positions.js';
import { watchThePosition } from './watch.js';

export async function surveyTheProgram(
  rpc: Rpc<SolanaRpcApi>,
  programAddress: Address,
  feePayer: Address,
  config: Config,
): Promise<Round<GuardSubject>> {
  const positions = await loadOpenPositions(rpc, programAddress);
  const limits: GuardLimits = {
    minProtectIntervalSeconds: Number(config.minProtectIntervalSeconds),
    minGrowIntervalSeconds: Number(config.minGrowIntervalSeconds),
    maxPriceAgeSlots: Number(config.maxPriceAgeSlots),
    growPaused: config.growPaused,
    sunset: config.sunset,
  };

  const candidates: Candidate<GuardSubject>[] = [];
  for (const position of positions) {
    const collateralEntry = config.allowedCollateral.find(
      (entry) => entry.mint === position.account.collateralMint,
    );
    const destination = config.allowedDestinations.find(
      (entry) => entry.mint === position.account.destinationMint,
    );
    if (collateralEntry === undefined || destination === undefined) {
      continue;
    }

    const market = await readTheMarketAfterARefresh(rpc, feePayer, {
      lendingMarket: position.account.market,
      obligation: position.account.obligation,
      collateralReserve: collateralEntry.reserve,
    }).catch(() => null);
    if (market === null) {
      continue;
    }

    const [destinationPrices, destinationMint, destinationAccount] = await Promise.all([
      readAccount(rpc, destination.scopePriceAccount),
      readAccount(rpc, destination.mint),
      readAccount(rpc, position.account.destinationTokenAccount),
    ]);
    if (destinationPrices === null || destinationMint === null) {
      continue;
    }

    candidates.push(
      watchThePosition({
        positionAddress: position.address,
        position: position.account,
        collateralEntry,
        destination,
        market,
        destinationPrice: decodeScopePrice(destinationPrices, destination.scopeFeedIndex),
        destinationDecimals: decodeMintDecimals(destinationMint),
        destinationBalance:
          destinationAccount === null ? 0n : decodeTokenAccountAmount(destinationAccount),
      }),
    );
  }

  return { limits, unixTimestamp: Math.floor(Date.now() / 1_000), candidates };
}

async function readAccount(
  rpc: Rpc<SolanaRpcApi>,
  account: Address,
): Promise<Uint8Array | null> {
  const response = await rpc.getAccountInfo(account, { encoding: 'base64' }).send();
  if (response.value === null) {
    return null;
  }
  return new Uint8Array(Buffer.from(response.value.data[0], 'base64'));
}
