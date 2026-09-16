import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { getPositionEncoder, PositionState } from '@accrue/solana/program';

import { POSITION_STATE_OFFSET } from './positions.js';

const SOME_ADDRESS = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

function encodeAPositionIn(state: PositionState): Uint8Array {
  return new Uint8Array(
    getPositionEncoder().encode({
      owner: SOME_ADDRESS,
      collateralMint: SOME_ADDRESS,
      destinationMint: SOME_ADDRESS,
      borrowMint: SOME_ADDRESS,
      market: SOME_ADDRESS,
      borrowReserve: SOME_ADDRESS,
      obligation: SOME_ADDRESS,
      collateralTokenAccount: SOME_ADDRESS,
      usdcTokenAccount: SOME_ADDRESS,
      destinationTokenAccount: SOME_ADDRESS,
      strategy: {
        targetLtvBps: 4_000,
        protectLtvBps: 5_000,
        growBelowLtvBps: 3_000,
        growEnabled: true,
        exitOnFlagEnabled: true,
      },
      feeBpsAtOpen: 1_000,
      state,
      openedAt: 0n,
      lastProtectAt: 0n,
      lastGrowAt: 0n,
      protectCount: 0,
      growCount: 0,
      usdcBorrowedTotal: 0n,
      usdcRepaidTotal: 0n,
      usdcFromSalesTotal: 0n,
      bump: 255,
    }),
  );
}

describe('the filter the keeper asks the chain for', () => {
  it('reads the state byte at the offset the filter uses', () => {
    for (const state of [
      PositionState.AwaitingSwap,
      PositionState.Open,
      PositionState.Closing,
      PositionState.Closed,
    ]) {
      const encoded = encodeAPositionIn(state);
      expect(encoded[Number(POSITION_STATE_OFFSET)]).toBe(state);
    }
  });

  it('matches only open positions', () => {
    const open = encodeAPositionIn(PositionState.Open);
    const awaiting = encodeAPositionIn(PositionState.AwaitingSwap);
    const offset = Number(POSITION_STATE_OFFSET);

    expect(open[offset]).toBe(PositionState.Open);
    expect(awaiting[offset]).not.toBe(PositionState.Open);
  });
});
