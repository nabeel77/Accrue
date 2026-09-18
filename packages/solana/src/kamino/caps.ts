import type { ReserveSnapshot, WithdrawalCapSnapshot } from './layout.js';

// What is left of a rolling cap right now, and when the window it belongs to starts again.
export interface CapacityLeft {
  // Zero when the market has turned this cap off, which it says with a capacity below zero.
  readonly isCapped: boolean;
  readonly capacity: bigint;
  readonly remaining: bigint;
  readonly windowResetsAt: bigint;
}

const NO_CAP = -1n;

export function capacityLeft(
  cap: WithdrawalCapSnapshot,
  nowUnixTimestamp: bigint,
): CapacityLeft {
  if (cap.capacity <= NO_CAP || cap.windowLengthSeconds === 0n) {
    return {
      isCapped: false,
      capacity: 0n,
      remaining: 0n,
      windowResetsAt: 0n,
    };
  }

  const windowEndsAt = cap.windowStartedAt + cap.windowLengthSeconds;
  const windowHasPassed = nowUnixTimestamp >= windowEndsAt;
  const used = windowHasPassed ? 0n : cap.usedInThisWindow;
  const remaining = cap.capacity > used ? cap.capacity - used : 0n;

  return {
    isCapped: true,
    capacity: cap.capacity,
    remaining,
    windowResetsAt: windowHasPassed
      ? nowUnixTimestamp + cap.windowLengthSeconds
      : windowEndsAt,
  };
}

// Both of the caps the market puts on a reserve, in the shape a screen shows them.
export interface ReserveCaps {
  readonly withdrawals: CapacityLeft;
  readonly borrows: CapacityLeft;
}

export function reserveCaps(
  reserve: ReserveSnapshot,
  nowUnixTimestamp: bigint,
): ReserveCaps {
  return {
    withdrawals: capacityLeft(reserve.depositWithdrawalCap, nowUnixTimestamp),
    borrows: capacityLeft(reserve.debtWithdrawalCap, nowUnixTimestamp),
  };
}
