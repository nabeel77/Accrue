import { thereIsAReasonToLeave, type DeleverageSignals } from '@accrue/core';

export type GuardAction = 'protect' | 'grow' | 'leave';

export type WaitingReason =
  | 'not open'
  | 'above the grow level and below the guard level'
  | 'the protect interval has not elapsed'
  | 'the grow interval has not elapsed'
  | 'nothing left to sell'
  | 'growing is paused'
  | 'growing is switched off'
  | 'the oracle price is stale';

export type Decision =
  | { readonly kind: GuardAction }
  | { readonly kind: 'wait'; readonly reason: WaitingReason };

export interface GuardLimits {
  readonly minProtectIntervalSeconds: number;
  readonly minGrowIntervalSeconds: number;
  readonly maxPriceAgeSlots: number;
  readonly growPaused: boolean;
  readonly sunset: boolean;
}

export interface PositionUnderWatch {
  readonly isOpen: boolean;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
  readonly growEnabled: boolean;
  readonly exitOnFlagEnabled: boolean;
  readonly lastProtectAt: number;
  readonly lastGrowAt: number;
  readonly loanToValueBps: number;
  readonly destinationBalance: bigint;
  readonly deleverage: DeleverageSignals;
  readonly oldestPriceAgeSlots: number;
}

export interface Now {
  readonly unixTimestamp: number;
}

function theIntervalHasElapsed(
  lastAt: number,
  now: number,
  intervalSeconds: number,
): boolean {
  return lastAt === 0 || now >= lastAt + intervalSeconds;
}

export function decideWhatToDo(
  position: PositionUnderWatch,
  limits: GuardLimits,
  now: Now,
): Decision {
  if (!position.isOpen) {
    return { kind: 'wait', reason: 'not open' };
  }

  const priceIsFresh = position.oldestPriceAgeSlots <= limits.maxPriceAgeSlots;

  if (position.loanToValueBps >= position.protectLtvBps) {
    if (!priceIsFresh) {
      return { kind: 'wait', reason: 'the oracle price is stale' };
    }
    if (position.destinationBalance === 0n) {
      return { kind: 'wait', reason: 'nothing left to sell' };
    }
    if (
      !theIntervalHasElapsed(
        position.lastProtectAt,
        now.unixTimestamp,
        limits.minProtectIntervalSeconds,
      )
    ) {
      return { kind: 'wait', reason: 'the protect interval has not elapsed' };
    }
    return { kind: 'protect' };
  }

  if (position.loanToValueBps <= position.growBelowLtvBps) {
    const growing = decideWhetherToGrow(position, limits, now, priceIsFresh);
    if (growing !== null) {
      return growing;
    }
  }

  const theMarketIsHandingItBack = thereIsAReasonToLeave(
    { ...position.deleverage, programIsRetiring: limits.sunset },
    BigInt(now.unixTimestamp),
  );
  if (limits.sunset || (position.exitOnFlagEnabled && theMarketIsHandingItBack)) {
    if (!priceIsFresh && position.destinationBalance > 0n) {
      return { kind: 'wait', reason: 'the oracle price is stale' };
    }
    return { kind: 'leave' };
  }

  return { kind: 'wait', reason: 'above the grow level and below the guard level' };
}

function decideWhetherToGrow(
  position: PositionUnderWatch,
  limits: GuardLimits,
  now: Now,
  priceIsFresh: boolean,
): Decision | null {
  if (limits.growPaused) {
    return { kind: 'wait', reason: 'growing is paused' };
  }
  if (!position.growEnabled) {
    return null;
  }
  if (!priceIsFresh) {
    return { kind: 'wait', reason: 'the oracle price is stale' };
  }
  if (
    !theIntervalHasElapsed(
      position.lastGrowAt,
      now.unixTimestamp,
      limits.minGrowIntervalSeconds,
    )
  ) {
    return { kind: 'wait', reason: 'the grow interval has not elapsed' };
  }
  return { kind: 'grow' };
}

// The most stretched position is the one worth a fee first.
export function mostStretchedFirst<Watched extends { readonly loanToValueBps: number }>(
  positions: readonly Watched[],
): Watched[] {
  return [...positions].sort((left, right) => right.loanToValueBps - left.loanToValueBps);
}
