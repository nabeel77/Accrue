import { address } from '@solana/kit';

import { destinationForMint } from '@accrue/core';
import { currentCluster } from '@accrue/solana';
import { readScopePrice } from '@accrue/solana/kamino';

import { positionsOwnedOnChain } from '../../../server/positions/ownedOnChain.js';
import { readOnePosition } from '../../../server/positions/readPositions.js';
import { readThePortfolio } from '../../../server/positions/portfolio.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, refuseWith, somethingWentWrong, tooMany } from '../../../server/respond.js';
import { chain } from '../../../server/rpc.js';
import { walletOfTheSession } from '../../../server/session.js';

const SCALED_FRACTION_ONE = 2n ** 60n;
const USDC_DECIMALS = 6;

function wholeUnits(raw: string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

function fromScaled(scaled: string): number {
  return Number(BigInt(scaled)) / Number(SCALED_FRACTION_ONE);
}

async function priceOfTheDestination(mint: string): Promise<number> {
  const destination = destinationForMint(mint);
  if (destination === null) {
    return 0;
  }
  try {
    const read = await readScopePrice(
      chain().rpc,
      currentCluster().scopePriceAccount,
      destination.scopeFeedIndex,
    );
    return Number(read.price.value) / 10 ** Number(read.price.exponent);
  } catch {
    return 0;
  }
}

export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuseWith('signInFirst', 401);
  }
  const limit = await withinTheLimit('read', 'portfolio', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }

  try {
    const owned = await positionsOwnedOnChain(address(wallet));
    const readings = await Promise.all(
      owned.map(async (entry) => ({
        reading: await readOnePosition(entry.address),
        destinationMint: entry.account.destinationMint,
      })),
    );

    const worths = [];
    let stockInYourWalletUsd = 0;
    let usdcInYourWalletUsd = 0;
    for (const { reading, destinationMint } of readings) {
      if (reading === null) {
        continue;
      }
      const destinationPrice = await priceOfTheDestination(destinationMint);
      worths.push({
        collateralValueUsd:
          wholeUnits(reading.collateralRaw, reading.collateralDecimals) *
          fromScaled(reading.oraclePriceScaled),
        debtUsd: wholeUnits(reading.debtRaw, USDC_DECIMALS),
        destinationValueUsd:
          wholeUnits(reading.destinationRaw, reading.destinationDecimals) *
          destinationPrice,
      });
      stockInYourWalletUsd +=
        wholeUnits(reading.ownerCollateralBalanceRaw, reading.collateralDecimals) *
        fromScaled(reading.oraclePriceScaled);
      usdcInYourWalletUsd = wholeUnits(
        reading.ownerBorrowBalanceRaw,
        reading.borrowDecimals,
      );
    }

    const portfolio = await readThePortfolio(
      wallet,
      worths,
      stockInYourWalletUsd,
      usdcInYourWalletUsd,
    );
    return ok({ readAt: new Date().toISOString(), ...portfolio });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
