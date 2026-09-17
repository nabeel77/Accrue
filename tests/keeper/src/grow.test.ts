import { describe, expect, it } from 'vitest';

import { createGuardInstructionBuilder } from '../../../apps/keeper/src/guard.js';
import { runOneRound } from '../../../apps/keeper/src/loop.js';
import { createRunLogThatOnlyCounts } from '../../../apps/keeper/src/runs.js';
import {
  openAGuardedPosition,
  positionAccount,
  SMALL_BORROW_AMOUNT,
} from './positions.js';
import { buildTheRound, createLiteSvmSender, refreshTheMarket } from './round.js';
import { createTestRouter } from './router.js';
import { reportComputeUnits, World } from './world.js';

const THE_STOCK_RISES = { numerator: 110n, denominator: 100n };

describe('a keeper round that grows a position below its grow level', () => {
  it('borrows back to target, buys the destination and records that it landed', async () => {
    const world = await World.create();
    await world.installSwapProgram('honest_swap.so');
    const opened = await openAGuardedPosition(world, SMALL_BORROW_AMOUNT);

    world.moveThePrice(
      world.collateral.snapshot.scopeFeedIndex,
      THE_STOCK_RISES.numerator,
      THE_STOCK_RISES.denominator,
    );
    await refreshTheMarket(world, opened.obligation);

    const round = await buildTheRound(world, opened);
    const strategy = positionAccount(world, opened.address).strategy;
    expect(round.candidates[0]?.loanToValueBps).toBeLessThanOrEqual(
      strategy.growBelowLtvBps,
    );

    const destinationBefore = world.tokenBalance(opened.tokens.positionDestination);
    const debtBefore = world
      .obligation(opened.obligation)
      .borrowedAmountScaledFor(world.borrow.address);

    const runLog = createRunLogThatOnlyCounts();
    const sender = createLiteSvmSender(world);
    const report = await runOneRound(
      round,
      createGuardInstructionBuilder({
        config: world.config(),
        configAddress: world.configAddress,
        caller: world.keeper,
        router: createTestRouter(world),
      }),
      sender.send,
      runLog,
      () => undefined,
    );

    expect(runLog.recorded[0]?.reason).toBeNull();
    expect(report).toEqual({ considered: 1, attempted: 1, landed: 1 });
    expect(runLog.recorded[0]?.kind).toBe('grow');
    expect(runLog.recorded[0]?.outcome).toBe('landed');
    expect(runLog.recorded[0]?.reason).toBeNull();

    reportComputeUnits('grow', sender.landed[0]?.computeUnits);

    expect(
      world.obligation(opened.obligation).borrowedAmountScaledFor(world.borrow.address),
    ).toBeGreaterThan(debtBefore);
    expect(world.tokenBalance(opened.tokens.positionDestination)).toBeGreaterThan(
      destinationBefore,
    );
    expect(world.tokenBalance(opened.tokens.positionUsdc)).toBe(0n);
    expect(world.tokenBalance(opened.tokens.positionCollateral)).toBe(0n);

    await refreshTheMarket(world, opened.obligation);
    expect(world.obligation(opened.obligation).loanToValueBps).toBeLessThanOrEqual(
      strategy.targetLtvBps,
    );

    const after = positionAccount(world, opened.address);
    expect(after.growCount).toBe(1);
    expect(after.lastGrowAt).toBe(world.unixTimestamp);
  });

  it('never grows while the guardian has growing paused', async () => {
    const world = await World.create();
    await world.installSwapProgram('honest_swap.so');
    const opened = await openAGuardedPosition(world, SMALL_BORROW_AMOUNT);

    world.moveThePrice(
      world.collateral.snapshot.scopeFeedIndex,
      THE_STOCK_RISES.numerator,
      THE_STOCK_RISES.denominator,
    );
    await refreshTheMarket(world, opened.obligation);
    await world.pauseGrows();

    const round = await buildTheRound(world, opened);
    const runLog = createRunLogThatOnlyCounts();

    const report = await runOneRound(
      round,
      createGuardInstructionBuilder({
        config: world.config(),
        configAddress: world.configAddress,
        caller: world.keeper,
        router: createTestRouter(world),
      }),
      () => Promise.reject(new Error('nothing should have been sent')),
      runLog,
      () => undefined,
    );

    expect(report).toEqual({ considered: 1, attempted: 0, landed: 0 });
    expect(runLog.recorded).toHaveLength(0);
  });
});
