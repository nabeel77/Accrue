import { describe, expect, it } from 'vitest';

import { PositionState } from '@accrue/solana/program';

import { createGuardInstructionBuilder } from '../../../apps/keeper/src/guard.js';
import { runOneRound } from '../../../apps/keeper/src/loop.js';
import { createRunLogThatOnlyCounts } from '../../../apps/keeper/src/runs.js';
import { openAGuardedPosition, positionAccount } from './positions.js';
import { buildTheRound, createLiteSvmSender } from './round.js';
import { createTestRouter } from './router.js';
import {
  reportComputeUnits,
  RESERVE_STATUS_OBSOLETE,
  RESERVE_STATUS_OFFSET,
  World,
} from './world.js';

describe('a keeper round that hands a position back when its reserve is flagged', () => {
  it('sells, repays, returns everything to the owner and records that it landed', async () => {
    const world = await World.create();
    await world.installSwapProgram('honest_swap.so');
    const opened = await openAGuardedPosition(world);

    world.setReserveByte(
      world.collateral.address,
      RESERVE_STATUS_OFFSET,
      RESERVE_STATUS_OBSOLETE,
    );

    const ownerStockBefore = world.tokenBalance(opened.tokens.ownerCollateral);
    const round = await buildTheRound(world, opened);
    expect(round.candidates[0]?.watched.reserveIsFlagged).toBe(true);

    const runLog = createRunLogThatOnlyCounts();
    const sender = createLiteSvmSender(world);
    const report = await runOneRound(
      round,
      createGuardInstructionBuilder({
        config: world.config(),
        configAddress: world.configAddress,
        caller: world.keeper,
        askTheRouter: createTestRouter(world),
      }),
      sender.send,
      runLog,
      () => undefined,
    );

    expect(runLog.recorded[0]?.reason).toBeNull();
    expect(report).toEqual({ considered: 1, attempted: 1, landed: 1 });
    expect(runLog.recorded[0]?.kind).toBe('leave');
    expect(runLog.recorded[0]?.outcome).toBe('landed');

    reportComputeUnits('leave', sender.landed[0]?.computeUnits);

    const obligation = world.obligationIfItExists(opened.obligation);
    expect(obligation?.borrowedAmountScaledFor(world.borrow.address) ?? 0n).toBe(0n);
    expect(obligation?.depositedAmountFor(world.collateral.address) ?? 0n).toBe(0n);
    expect(world.tokenBalance(opened.tokens.positionUsdc)).toBe(0n);
    expect(world.tokenBalance(opened.tokens.positionDestination)).toBe(0n);
    expect(world.tokenBalance(opened.tokens.positionCollateral)).toBe(0n);
    expect(world.tokenBalance(opened.tokens.ownerCollateral)).toBeGreaterThan(
      ownerStockBefore,
    );
    expect(world.tokenBalance(world.treasuryUsdcAccount)).toBe(0n);
    expect(positionAccount(world, opened.address).state).toBe(PositionState.Closed);
  });

  it('leaves a position alone while its reserve is healthy', async () => {
    const world = await World.create();
    await world.installSwapProgram('honest_swap.so');
    const opened = await openAGuardedPosition(world);

    const round = await buildTheRound(world, opened);
    expect(round.candidates[0]?.watched.reserveIsFlagged).toBe(false);

    const runLog = createRunLogThatOnlyCounts();
    const report = await runOneRound(
      round,
      createGuardInstructionBuilder({
        config: world.config(),
        configAddress: world.configAddress,
        caller: world.keeper,
        askTheRouter: createTestRouter(world),
      }),
      () => Promise.reject(new Error('nothing should have been sent')),
      runLog,
      () => undefined,
    );

    expect(report).toEqual({ considered: 1, attempted: 0, landed: 0 });
    expect(positionAccount(world, opened.address).state).toBe(PositionState.Open);
  });
});
