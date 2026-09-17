import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { createGuardInstructionBuilder } from '../../../apps/keeper/src/guard.js';
import { runOneRound } from '../../../apps/keeper/src/loop.js';
import { createRunLogThatOnlyCounts } from '../../../apps/keeper/src/runs.js';
import { openAGuardedPosition, type OpenedPosition } from './positions.js';
import { buildTheRound, createLiteSvmSender, refreshTheMarket } from './round.js';
import { createTestRouter, type RouterBehaviour } from './router.js';
import { readEverythingThatMustNotMove } from './untouched.js';
import { World } from './world.js';

const A_QUARTER_OFF = { numerator: 78n, denominator: 100n };

const ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING = 0;
const ATTACK_PAY_LESS_THAN_THE_MINIMUM = 1;
const ATTACK_SEND_THE_OUTPUT_SOMEWHERE_ELSE = 2;
const ATTACK_DRAIN_AN_ACCOUNT_IT_WAS_HANDED = 3;
const ATTACK_CLOSE_AN_ACCOUNT_IT_WAS_HANDED = 4;
const ATTACK_APPROVE_ITSELF_AS_DELEGATE = 6;
const ATTACK_TAKE_THE_OWNER_AUTHORITY = 7;
const ATTACK_SET_A_CLOSE_AUTHORITY = 8;

interface Attempt {
  readonly attack: number;
  readonly named: string;
  readonly refusedWith: string;
  readonly behaviour: (world: World, opened: OpenedPosition) => Promise<RouterBehaviour>;
}

async function aStrangersUsdcAccount(world: World): Promise<Address> {
  return world.createTokenAccount({
    mint: world.borrow.snapshot.liquidityMint,
    owner: world.stranger.address,
    amount: 0n,
    tokenProgram: world.borrow.snapshot.liquidityTokenProgram,
  });
}

const attempts: Attempt[] = [
  {
    attack: ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING,
    named: 'keeping the input and paying nothing',
    refusedWith: 'SwapReturnedTooLittle',
    behaviour: () => Promise.resolve({ pays: () => 0n }),
  },
  {
    attack: ATTACK_PAY_LESS_THAN_THE_MINIMUM,
    named: 'paying under the minimum',
    refusedWith: 'SwapReturnedTooLittle',
    behaviour: () => Promise.resolve({ pays: (fair) => fair / 4n }),
  },
  {
    attack: ATTACK_SEND_THE_OUTPUT_SOMEWHERE_ELSE,
    named: 'sending the output to a stranger',
    refusedWith: 'SwapReturnedTooLittle',
    behaviour: async (world) => ({ wants: await aStrangersUsdcAccount(world) }),
  },
  {
    attack: ATTACK_DRAIN_AN_ACCOUNT_IT_WAS_HANDED,
    named: 'asking for the stock account',
    refusedWith: 'SwapRouteTouchesAForbiddenAccount',
    behaviour: (_world, opened) =>
      Promise.resolve({ wants: opened.tokens.positionCollateral, pays: () => 0n }),
  },
  // The token program refuses this one inside the route, before the swap returns and before the
  // program's own invariants run. Either way nothing moves.
  {
    attack: ATTACK_CLOSE_AN_ACCOUNT_IT_WAS_HANDED,
    named: 'closing the account it was handed',
    refusedWith: 'Non-native account can only be closed if its balance is zero',
    behaviour: (world) => Promise.resolve({ wants: world.stranger.address }),
  },
  {
    attack: ATTACK_APPROVE_ITSELF_AS_DELEGATE,
    named: 'approving itself as delegate',
    refusedWith: 'PositionTokenAccountHasADelegate',
    behaviour: (world) => Promise.resolve({ wants: world.stranger.address }),
  },
  // Taking the owner authority is caught one step earlier than the invariant: the repay that
  // follows the swap moves USDC with the position as authority, and the token program refuses.
  {
    attack: ATTACK_TAKE_THE_OWNER_AUTHORITY,
    named: 'taking the owner authority',
    refusedWith: 'owner does not match',
    behaviour: (world) => Promise.resolve({ wants: world.stranger.address }),
  },
  {
    attack: ATTACK_SET_A_CLOSE_AUTHORITY,
    named: 'setting a close authority',
    refusedWith: 'PositionTokenAccountHasACloseAuthority',
    behaviour: (world) => Promise.resolve({ wants: world.stranger.address }),
  },
];

async function aPositionThatNeedsTheGuard(): Promise<[World, OpenedPosition]> {
  const world = await World.create();
  await world.installSwapProgram('hostile_swap.so');
  const opened = await openAGuardedPosition(world);

  world.moveThePrice(
    world.collateral.snapshot.scopeFeedIndex,
    A_QUARTER_OFF.numerator,
    A_QUARTER_OFF.denominator,
  );
  await refreshTheMarket(world, opened.obligation);
  return [world, opened];
}

describe('a keeper round against the hostile router', () => {
  for (const attempt of attempts) {
    it(`records ${attempt.named} as reverted and leaves the position untouched`, async () => {
      const [world, opened] = await aPositionThatNeedsTheGuard();
      const bountyAccount = await world.createTokenAccount({
        mint: world.borrow.snapshot.liquidityMint,
        owner: world.keeper.address,
        amount: 0n,
        tokenProgram: world.borrow.snapshot.liquidityTokenProgram,
      });

      const behaviour = await attempt.behaviour(world, opened);
      const round = await buildTheRound(world, opened);
      const before = readEverythingThatMustNotMove(world, opened);

      const runLog = createRunLogThatOnlyCounts();
      const report = await runOneRound(
        round,
        createGuardInstructionBuilder({
          config: world.config(),
          configAddress: world.configAddress,
          caller: world.keeper,
          router: createTestRouter(world, { ...behaviour, attack: attempt.attack }),
        }),
        createLiteSvmSender(world).send,
        runLog,
        () => undefined,
      );

      expect(report).toEqual({ considered: 1, attempted: 1, landed: 0 });
      expect(runLog.recorded[0]?.kind).toBe('protect');
      expect(runLog.recorded[0]?.outcome).toBe('reverted');
      expect(runLog.recorded[0]?.signature).toBeNull();
      expect(runLog.recorded[0]?.reason).toBe(attempt.refusedWith);

      expect(readEverythingThatMustNotMove(world, opened)).toEqual(before);
      expect(world.tokenBalance(bountyAccount)).toBe(0n);
    });
  }

  it('lets an honest fill through the same program, or the attacks prove nothing', async () => {
    const [world, opened] = await aPositionThatNeedsTheGuard();
    await world.createTokenAccount({
      mint: world.borrow.snapshot.liquidityMint,
      owner: world.keeper.address,
      amount: 0n,
      tokenProgram: world.borrow.snapshot.liquidityTokenProgram,
    });

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
      createLiteSvmSender(world).send,
      runLog,
      () => undefined,
    );

    expect(runLog.recorded[0]?.reason).toBeNull();
    expect(report).toEqual({ considered: 1, attempted: 1, landed: 1 });
  });
});
