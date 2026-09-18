import { BASIS_POINTS_DENOMINATOR, SCALED_FRACTION_ONE } from '../money.js';
import { valuedForBorrowing } from './priceMargin.js';

// The market values the stock a top up just put in, not the app, and it rounds every step of
// that against the position. Asking for the whole room the target leaves can land the debt a
// hair above target, which the program refuses outright, so the app asks for a little less.
export const ROOM_LEFT_UNDER_TARGET_BPS = 10n;
const A_CENT_SCALED = SCALED_FRACTION_ONE / 100n;

export function theBorrowToAskFor(roomScaled: bigint): bigint {
  const share = (roomScaled * ROOM_LEFT_UNDER_TARGET_BPS) / BASIS_POINTS_DENOMINATOR;
  const margin = share > A_CENT_SCALED ? share : A_CENT_SCALED;
  return roomScaled > margin ? roomScaled - margin : 0n;
}

export interface PositionNow {
  // What the market says the position holds and owes right now, both as scaled USD.
  readonly collateralValueScaled: bigint;
  readonly adjustedDebtValueScaled: bigint;
  readonly targetLtvBps: number;
}

export interface TopUpSizing {
  readonly addedValueScaled: bigint;
  readonly borrowValueScaled: bigint;
  readonly collateralValueAfterScaled: bigint;
  readonly debtValueAfterScaled: bigint;
  readonly loanToValueAfterBps: number;
}

// What a position may borrow against value added to it: the room its target leaves once the new
// collateral is in, never more, and never less than nothing.
export function borrowForAddedValue(
  position: PositionNow,
  addedValueScaled: bigint,
  // The app sizes what it will ask the chain for against a value under the one it read. The
  // worked example is the plain arithmetic, so it does not.
  againstAPriceThatMayHaveMoved = false,
): bigint {
  const held = position.collateralValueScaled + addedValueScaled;
  const collateralAfter = againstAPriceThatMayHaveMoved ? valuedForBorrowing(held) : held;
  const allowed =
    (collateralAfter * BigInt(position.targetLtvBps)) / BASIS_POINTS_DENOMINATOR;
  return allowed > position.adjustedDebtValueScaled
    ? allowed - position.adjustedDebtValueScaled
    : 0n;
}

export function loanToValueBpsAfter(
  collateralValueScaled: bigint,
  debtValueScaled: bigint,
): number {
  if (collateralValueScaled === 0n) {
    return 0;
  }
  return Number((debtValueScaled * BASIS_POINTS_DENOMINATOR) / collateralValueScaled);
}

// Everything the deposit screen states about a top up, from the position as the chain has it.
// The app leaves itself room under the target; the worked example does not, so both are here.
export function sizeATopUp(
  position: PositionNow,
  addedValueScaled: bigint,
  leaveRoomUnderTheTarget = false,
): TopUpSizing {
  const room = borrowForAddedValue(position, addedValueScaled, leaveRoomUnderTheTarget);
  const borrowValueScaled = leaveRoomUnderTheTarget ? theBorrowToAskFor(room) : room;
  const collateralValueAfterScaled = position.collateralValueScaled + addedValueScaled;
  const debtValueAfterScaled = position.adjustedDebtValueScaled + borrowValueScaled;
  return {
    addedValueScaled,
    borrowValueScaled,
    collateralValueAfterScaled,
    debtValueAfterScaled,
    loanToValueAfterBps: loanToValueBpsAfter(
      collateralValueAfterScaled,
      debtValueAfterScaled,
    ),
  };
}
