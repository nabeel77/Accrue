import { destinationForMint } from '@accrue/core';

import { priceBoundsFor, type PriceBounds } from './reserveConfig.js';
import { SANDBOX_TOKENS, type SandboxToken } from './tokens.js';

const BASIS_POINTS = 10_000;
const SECONDS_IN_A_YEAR = 365 * 24 * 60 * 60;
const PERCENT = 100;
// A price written hard against a bound is a price the market can refuse on the next rounding, so
// the walk stays this far inside the room it has.
const ROOM_INSIDE_THE_BOUNDS = 0.01;

export interface WalkKnobs {
  readonly writeSeconds: number;
  readonly stepSeconds: number;
  // The largest ordinary move, up or down, in percent.
  readonly stepPercent: number;
  // How much of the gap back to the book price one step closes, in percent.
  readonly pullPercent: number;
  // The chance a step is a big move instead of an ordinary one, between zero and one.
  readonly bigMoveOdds: number;
  readonly bigMoveLowPercent: number;
  readonly bigMoveHighPercent: number;
  readonly recoverySteps: number;
  // How many seconds of earning the yield token gets for every second that passes on a sandbox,
  // so a rate published per year is visible in a sitting.
  readonly yieldTimesFaster: number;
  // A yield token earns, but its price is a mark that can be written down, so the sandbox marks it
  // down now and then and climbs back to where it was over the steps that follow.
  readonly yieldDipOdds: number;
  readonly yieldDipLowPercent: number;
  readonly yieldDipHighPercent: number;
  readonly yieldWobblePercent: number;
}

const DEFAULTS: WalkKnobs = {
  writeSeconds: 20,
  stepSeconds: 300,
  stepPercent: 4,
  pullPercent: 25,
  bigMoveOdds: 0.083,
  bigMoveLowPercent: 20,
  bigMoveHighPercent: 25,
  recoverySteps: 6,
  yieldTimesFaster: 1,
  yieldDipOdds: 0.03,
  yieldDipLowPercent: 1,
  yieldDipHighPercent: 3,
  yieldWobblePercent: 0.15,
};

function number(name: string, fallback: number): number {
  const given = Number(process.env[name] ?? '');
  return Number.isFinite(given) && given > 0 ? given : fallback;
}

export function knobsFromTheEnvironment(): WalkKnobs {
  return {
    writeSeconds: number('DEVNET_PRICE_WRITE_SECONDS', DEFAULTS.writeSeconds),
    stepSeconds: number('DEVNET_PRICE_STEP_SECONDS', DEFAULTS.stepSeconds),
    stepPercent: number('DEVNET_PRICE_STEP_PERCENT', DEFAULTS.stepPercent),
    pullPercent: number('DEVNET_PRICE_PULL_PERCENT', DEFAULTS.pullPercent),
    bigMoveOdds: number('DEVNET_PRICE_BIG_MOVE_ODDS', DEFAULTS.bigMoveOdds),
    bigMoveLowPercent: number(
      'DEVNET_PRICE_BIG_MOVE_LOW_PERCENT',
      DEFAULTS.bigMoveLowPercent,
    ),
    bigMoveHighPercent: number(
      'DEVNET_PRICE_BIG_MOVE_HIGH_PERCENT',
      DEFAULTS.bigMoveHighPercent,
    ),
    recoverySteps: number('DEVNET_PRICE_RECOVERY_STEPS', DEFAULTS.recoverySteps),
    yieldTimesFaster: number('DEVNET_YIELD_TIMES_FASTER', DEFAULTS.yieldTimesFaster),
    yieldDipOdds: number('DEVNET_YIELD_DIP_ODDS', DEFAULTS.yieldDipOdds),
    yieldDipLowPercent: number(
      'DEVNET_YIELD_DIP_LOW_PERCENT',
      DEFAULTS.yieldDipLowPercent,
    ),
    yieldDipHighPercent: number(
      'DEVNET_YIELD_DIP_HIGH_PERCENT',
      DEFAULTS.yieldDipHighPercent,
    ),
    yieldWobblePercent: number(
      'DEVNET_YIELD_WOBBLE_PERCENT',
      DEFAULTS.yieldWobblePercent,
    ),
  };
}

// USDC is the unit everything else is priced in, and the yield token earns rather than moves.
export function theStocksThatAreWalked(): readonly SandboxToken[] {
  return SANDBOX_TOKENS.filter(
    (token) => token.symbol !== 'USDC' && destinationForMint(token.mainnetMint) === null,
  );
}

export function theYieldRateOf(token: SandboxToken): number | null {
  return destinationForMint(token.mainnetMint)?.targetRateBps ?? null;
}

const A_SLOT_IN_MILLISECONDS = 400;
const MILLISECONDS_IN_A_SECOND = 1_000;
// A price is stale for whatever is left of the window after the last write, so the service writes
// several times inside one, leaving room for a slow confirmation.
const WRITES_PER_WINDOW = 3;

// The program refuses a price older than its config allows, so a service slower than that window
// is no use to the guard. What was asked for is held to what the window needs.
export function theWriteIntervalTheGuardCanLiveWith(asked: number): {
  seconds: number;
  note: string;
} {
  const maxAgeSlots = Number(process.env['ACCRUE_CONFIG_MAX_PRICE_AGE_SLOTS'] ?? 0);
  if (!Number.isFinite(maxAgeSlots) || maxAgeSlots <= 0) {
    return { seconds: asked, note: `every ${asked}s` };
  }
  const windowSeconds = (maxAgeSlots * A_SLOT_IN_MILLISECONDS) / MILLISECONDS_IN_A_SECOND;
  const fastEnough = Math.max(1, Math.floor(windowSeconds / WRITES_PER_WINDOW));
  if (asked <= fastEnough) {
    return {
      seconds: asked,
      note: `every ${asked}s, inside the ${windowSeconds}s the program allows a price to be old`,
    };
  }
  return {
    seconds: fastEnough,
    note: `every ${fastEnough}s, not the ${asked}s asked for: the program allows a price ${maxAgeSlots} slots old, about ${windowSeconds}s, and a slower service leaves the guard refusing`,
  };
}

export function clampToTheBounds(price: number, bounds: PriceBounds): number {
  const lowest = bounds.lowest * (1 + ROOM_INSIDE_THE_BOUNDS);
  const highest = bounds.highest * (1 - ROOM_INSIDE_THE_BOUNDS);
  return Math.min(Math.max(price, lowest), highest);
}

export interface WalkState {
  recoveryStepsLeft: number;
}

export interface YieldWalkState {
  recoveryStepsLeft: number;
  // A yield token has no book price to come back to, so a mark down remembers where it fell from.
  climbingBackTo: number | null;
}

export interface Step {
  readonly symbol: string;
  readonly from: number;
  readonly to: number;
  readonly why: string;
}

// One move for one stock: a big fall now and then, the climb back out of it over the steps that
// follow, and otherwise a small random move pulled gently back toward the book price.
export function stepAStock(
  token: SandboxToken,
  price: number,
  bounds: PriceBounds,
  knobs: WalkKnobs,
  state: WalkState,
  roll: () => number = Math.random,
): Step {
  const book = token.startingPrice;
  const gapPercent = ((book - price) / price) * PERCENT;

  let movePercent: number;
  let why: string;
  if (state.recoveryStepsLeft > 0) {
    movePercent = gapPercent / state.recoveryStepsLeft;
    why = `recovering, ${state.recoveryStepsLeft} steps left`;
    state.recoveryStepsLeft -= 1;
  } else if (roll() < knobs.bigMoveOdds) {
    const spread = knobs.bigMoveHighPercent - knobs.bigMoveLowPercent;
    movePercent = -(knobs.bigMoveLowPercent + roll() * spread);
    state.recoveryStepsLeft = knobs.recoverySteps;
    why = 'big move';
  } else {
    const drift = (roll() * 2 - 1) * knobs.stepPercent;
    movePercent = drift + (gapPercent * knobs.pullPercent) / PERCENT;
    why = 'drift';
  }

  const to = clampToTheBounds(price * (1 + movePercent / PERCENT), bounds);
  return { symbol: token.symbol, from: price, to, why };
}

// One move for one yield token: earning is applied on every write, so this is only the mark, which
// is written down now and then and climbs back to where it fell from over the steps that follow.
export function stepAYieldToken(
  token: SandboxToken,
  price: number,
  bounds: PriceBounds,
  knobs: WalkKnobs,
  state: YieldWalkState,
  roll: () => number = Math.random,
): Step {
  let movePercent: number;
  let why: string;
  if (state.recoveryStepsLeft > 0 && state.climbingBackTo !== null) {
    const gapPercent = ((state.climbingBackTo - price) / price) * PERCENT;
    movePercent = gapPercent / state.recoveryStepsLeft;
    why = `climbing back, ${state.recoveryStepsLeft} steps left`;
    state.recoveryStepsLeft -= 1;
    if (state.recoveryStepsLeft === 0) {
      state.climbingBackTo = null;
    }
  } else if (roll() < knobs.yieldDipOdds) {
    const spread = knobs.yieldDipHighPercent - knobs.yieldDipLowPercent;
    movePercent = -(knobs.yieldDipLowPercent + roll() * spread);
    state.recoveryStepsLeft = knobs.recoverySteps;
    state.climbingBackTo = price;
    why = 'marked down';
  } else {
    movePercent = (roll() * 2 - 1) * knobs.yieldWobblePercent;
    why = 'wobble';
  }

  const to = clampToTheBounds(price * (1 + movePercent / PERCENT), bounds);
  return { symbol: token.symbol, from: price, to, why };
}

// The yield token does not move with a market, it earns, so it climbs at its published rate for
// however long it has been since the last write.
export function accrueTheYield(
  token: SandboxToken,
  price: number,
  rateBps: number,
  seconds: number,
  bounds: PriceBounds,
  timesFaster = 1,
): Step {
  const earning = seconds * timesFaster;
  const growth = (1 + rateBps / BASIS_POINTS) ** (earning / SECONDS_IN_A_YEAR);
  const faster = timesFaster > 1 ? `, ${timesFaster} times faster on a sandbox` : '';
  return {
    symbol: token.symbol,
    from: price,
    to: clampToTheBounds(price * growth, bounds),
    why: `earning ${(rateBps / PERCENT).toFixed(2)} percent a year${faster}`,
  };
}

export function boundsBySymbol(): Map<string, PriceBounds> {
  return new Map(SANDBOX_TOKENS.map((token) => [token.symbol, priceBoundsFor(token)]));
}
