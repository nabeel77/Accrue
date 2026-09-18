import type { Address } from '@solana/kit';

import { usdPerWholeTokenScaled } from '@accrue/core';
import type { ScopePrice } from '@accrue/solana/kamino';
import {
  PositionState,
  type CollateralEntry,
  type DestinationEntry,
  type Position,
} from '@accrue/solana/program';

import type { GuardSubject } from './guard.js';
import type { Candidate } from './loop.js';
import type { MarketReading } from './market.js';

export interface ChainReading {
  readonly positionAddress: Address;
  readonly position: Position;
  readonly collateralEntry: CollateralEntry;
  readonly destination: DestinationEntry;
  readonly market: MarketReading;
  readonly destinationPrice: ScopePrice;
  readonly destinationDecimals: number;
  readonly destinationBalance: bigint;
}

function ageInSlots(price: ScopePrice, currentSlot: bigint): number {
  return price.lastUpdatedSlot >= currentSlot
    ? 0
    : Number(currentSlot - price.lastUpdatedSlot);
}

export function watchThePosition(reading: ChainReading): Candidate<GuardSubject> {
  const loanToValueBps = reading.market.obligation.loanToValueBps;
  const oldestPriceAgeSlots = Math.max(
    ageInSlots(reading.market.usdcPrice, reading.market.currentSlot),
    ageInSlots(reading.destinationPrice, reading.market.currentSlot),
  );

  return {
    address: reading.positionAddress,
    loanToValueBps,
    watched: {
      isOpen: reading.position.state === PositionState.Open,
      protectLtvBps: reading.position.strategy.protectLtvBps,
      growBelowLtvBps: reading.position.strategy.growBelowLtvBps,
      growEnabled: reading.position.strategy.growEnabled,
      exitOnFlagEnabled: reading.position.strategy.exitOnFlagEnabled,
      lastProtectAt: Number(reading.position.lastProtectAt),
      lastGrowAt: Number(reading.position.lastGrowAt),
      loanToValueBps,
      destinationBalance: reading.destinationBalance,
      deleverage: {
        reserveStatusObsolete: reading.market.collateralReserve.isObsolete,
        programIsRetiring: false,
        obligationMarginCallStartedAt:
          reading.market.obligation.autodeleverageMarginCallStartedTimestamp,
        marketAutodeleverageEnabled: reading.market.lendingMarket.autodeleverageEnabled,
        reserveAutodeleverageEnabled:
          reading.market.collateralReserve.autodeleverageEnabled,
        depositLimitCrossedAt:
          reading.market.collateralReserve.depositLimitCrossedTimestamp,
        borrowLimitCrossedAt:
          reading.market.collateralReserve.borrowLimitCrossedTimestamp,
        marginCallPeriodSeconds:
          reading.market.collateralReserve.deleveragingMarginCallPeriodSeconds,
      },
      oldestPriceAgeSlots,
    },
    subject: {
      positionAddress: reading.positionAddress,
      position: reading.position,
      obligation: reading.market.obligation,
      collateralReserveAddress: reading.collateralEntry.reserve,
      collateralReserve: reading.market.collateralReserve,
      borrowReserveAddress: reading.market.borrowReserveAddress,
      borrowReserve: reading.market.borrowReserve,
      destination: reading.destination,
      destinationDecimals: reading.destinationDecimals,
      destinationBalance: reading.destinationBalance,
      usdcPriceScaled: usdPerWholeTokenScaled(reading.market.usdcPrice),
      destinationPriceScaled: usdPerWholeTokenScaled(reading.destinationPrice),
    } satisfies GuardSubject,
  };
}
