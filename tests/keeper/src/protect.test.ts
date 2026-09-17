import { describe, expect, it } from 'vitest';

import { createRunLogThatOnlyCounts } from '../../../apps/keeper/src/runs.js';
import { createGuardInstructionBuilder } from '../../../apps/keeper/src/guard.js';
import { runOneRound } from '../../../apps/keeper/src/loop.js';
import { openAGuardedPosition, positionAccount } from './positions.js';
import { buildTheRound, createLiteSvmSender, refreshTheMarket } from './round.js';
import { createTestRouter } from './router.js';
import { reportComputeUnits, World } from './world.js';

const A_QUARTER_OFF = { numerator: 78n, denominator: 100n };

describe('a keeper round that protects a position past its guard level', () => {
  it('sells, repays to target, pays itself the bounty and records that it landed', async () => {
    const world = await World.create();
    await world.installSwapProgram('honest_swap.so');
    const opened = await openAGuardedPosition(world);

    world.moveThePrice(
      world.collateral.snapshot.scopeFeedIndex,
      A_QUARTER_OFF.numerator,
      A_QUARTER_OFF.denominator,
    );
    await refreshTheMarket(world, opened.obligation);

    const bountyAccount = await world.createTokenAccount({
      mint: world.borrow.snapshot.liquidityMint,
      owner: world.keeper.address,
      amount: 0n,
      tokenProgram: world.borrow.snapshot.liquidityTokenProgram,
    });

    const round = await buildTheRound(world, opened);
    const strategy = positionAccount(world, opened.address).strategy;
    expect(round.candidates[0]?.loanToValueBps).toBeGreaterThanOrEqual(
      strategy.protectLtvBps,
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

    expect(report).toEqual({ considered: 1, attempted: 1, landed: 1 });
    expect(runLog.recorded).toHaveLength(1);
    expect(runLog.recorded[0]?.kind).toBe('protect');
    expect(runLog.recorded[0]?.outcome).toBe('landed');
    expect(runLog.recorded[0]?.reason).toBeNull();

    reportComputeUnits('protect', sender.landed[0]?.computeUnits);

    expect(world.tokenBalance(opened.tokens.positionDestination)).toBeLessThan(
      destinationBefore,
    );
    expect(
      world.obligation(opened.obligation).borrowedAmountScaledFor(world.borrow.address),
    ).toBeLessThan(debtBefore);
    expect(world.tokenBalance(bountyAccount)).toBeGreaterThan(0n);
    expect(world.tokenBalance(bountyAccount)).toBeLessThanOrEqual(
      world.config().keeperBountyCapUsdc,
    );
    expect(world.tokenBalance(opened.tokens.positionCollateral)).toBe(0n);

    await refreshTheMarket(world, opened.obligation);
    expect(world.obligation(opened.obligation).loanToValueBps).toBeLessThanOrEqual(
      strategy.targetLtvBps,
    );

    const after = positionAccount(world, opened.address);
    expect(after.protectCount).toBe(1);
    expect(after.lastProtectAt).toBe(world.unixTimestamp);
  });

  it('proposes nothing for a position sitting inside its band', async () => {
    const world = await World.create();
    await world.installSwapProgram('honest_swap.so');
    const opened = await openAGuardedPosition(world);

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
