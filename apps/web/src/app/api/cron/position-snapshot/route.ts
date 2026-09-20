import { address } from '@solana/kit';
import { eq } from 'drizzle-orm';

import { schema } from '@accrue/db';

import { db } from '../../../../server/database.js';
import { currentCluster } from '@accrue/solana';
import { readScopePrice } from '@accrue/solana/kamino';

import { cronIsAuthorised } from '../../../../server/cron.js';
import { destinationForMintOnThisCluster } from '../../../../server/markets.js';
import { readOnePosition } from '../../../../server/positions/readPositions.js';
import { ok, refuse, somethingWentWrong } from '../../../../server/respond.js';
import { chain } from '../../../../server/rpc.js';
import { latestDestinationTarget } from '../../../../server/snapshots.js';

const SCALED_FRACTION_ONE = 2n ** 60n;
const USDC_DECIMALS = 6;
const BASIS_POINTS = 10_000;

function wholeUnits(raw: string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

function fromScaled(scaled: string): number {
  return Number(BigInt(scaled)) / Number(SCALED_FRACTION_ONE);
}

export async function POST(request: Request): Promise<Response> {
  if (!cronIsAuthorised(request)) {
    return refuse('No.', 401);
  }
  try {
    const open = await db()
      .select({
        id: schema.positions.id,
        positionAddress: schema.positions.positionAddress,
        destinationMint: schema.positions.destinationMint,
      })
      .from(schema.positions)
      .where(eq(schema.positions.status, 'open'));

    const cluster = currentCluster();
    let written = 0;
    for (const row of open) {
      if (row.positionAddress === null) {
        continue;
      }
      const reading = await readOnePosition(address(row.positionAddress));
      if (reading === null) {
        continue;
      }

      const destination = destinationForMintOnThisCluster(row.destinationMint);
      let destinationPrice = 0;
      let priceAgeSlots: bigint | null = null;
      if (destination !== null) {
        try {
          const read = await readScopePrice(
            chain().rpc,
            cluster.scopePriceAccount,
            destination.scopeFeedIndex,
          );
          destinationPrice = Number(read.price.value) / 10 ** Number(read.price.exponent);
          priceAgeSlots = read.ageInSlots;
        } catch {
          destinationPrice = 0;
        }
      }

      const collateralValueUsd =
        wholeUnits(reading.collateralRaw, reading.collateralDecimals) *
        fromScaled(reading.oraclePriceScaled);
      const debtUsd = wholeUnits(reading.debtRaw, USDC_DECIMALS);
      const destinationValueUsd =
        wholeUnits(reading.destinationRaw, destination?.decimals ?? USDC_DECIMALS) *
        destinationPrice;
      const target =
        destination === null ? null : await latestDestinationTarget(destination);

      await db()
        .insert(schema.positionSnapshots)
        .values({
          positionId: row.id,
          collateralValueUsd: collateralValueUsd.toFixed(6),
          debtUsd: debtUsd.toFixed(6),
          ltv: (collateralValueUsd === 0 ? 0 : debtUsd / collateralValueUsd).toFixed(6),
          health: reading.healthZone as 'healthy' | 'caution' | 'danger',
          aboveProtect: reading.loanToValueBps >= reading.protectLtvBps,
          destinationValueUsd: destinationValueUsd.toFixed(6),
          netEarnedUsd: (destinationValueUsd - debtUsd).toFixed(6),
          borrowApy: (reading.borrowRateBps / BASIS_POINTS).toFixed(6),
          destinationApy: ((target?.rateBps ?? 0) / BASIS_POINTS).toFixed(6),
          scopePriceAgeSlots: priceAgeSlots,
        });
      written += 1;

      if (reading.state === 'Closed') {
        await db()
          .update(schema.positions)
          .set({ status: 'closed', closedAt: new Date() })
          .where(eq(schema.positions.id, row.id));
      }
    }
    return ok({ written });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
