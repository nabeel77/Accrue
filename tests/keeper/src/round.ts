import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AccountRole, type Instruction } from '@solana/kit';
import type { FailedTransactionMetadata } from 'litesvm';

import {
  getRefreshObligationInstruction,
  getRefreshReserveInstruction,
} from '@accrue/solana/kamino';

import type { GuardSubject } from '../../../apps/keeper/src/guard.js';
import type { Round } from '../../../apps/keeper/src/loop.js';
import type { MarketReading } from '../../../apps/keeper/src/market.js';
import { watchThePosition } from '../../../apps/keeper/src/watch.js';
import { repositoryRoot } from './fixtures.js';
import { positionAccount, type OpenedPosition } from './positions.js';
import {
  DESTINATION_DECIMALS,
  ONYC_SCOPE_FEED_INDEX,
  type Landed,
  type World,
} from './world.js';

interface ProgramErrorInIdl {
  readonly code: number;
  readonly name: string;
  readonly msg: string;
}

const programErrors = (
  JSON.parse(readFileSync(resolve(repositoryRoot, 'target/idl/accrue.json'), 'utf8')) as {
    errors: ProgramErrorInIdl[];
  }
).errors;

/** The name the program gives the code it reverted with, read from the program's own IDL. */
export function programErrorName(code: number): string {
  return programErrors.find((error) => error.code === code)?.name ?? `code ${code}`;
}

function lastMatchIn(logs: readonly string[], pattern: RegExp): string | undefined {
  return logs
    .map((line) => pattern.exec(line)?.[1])
    .filter((found): found is string => found !== undefined)
    .at(-1);
}

/**
 * Why the transaction reverted, in the words of whichever program refused. Reading it out of the
 * log rather than out of the code means a token program error is never mistaken for one of ours.
 */
function reasonFor(failure: FailedTransactionMetadata): string {
  const logs = failure.meta().logs();
  const anchorName = lastMatchIn(logs, /Error Code: (\w+)\./u);
  if (anchorName !== undefined) {
    return anchorName;
  }
  const tokenProgramSaid = lastMatchIn(logs, /Program log: Error: (.+)$/u);
  if (tokenProgramSaid !== undefined) {
    return tokenProgramSaid;
  }

  const error = failure.err() as { err?: () => { code?: number } };
  const inner = typeof error.err === 'function' ? error.err() : null;
  if (inner !== null && typeof inner.code === 'number') {
    return programErrorName(inner.code);
  }
  return failure.toString();
}

/** Runs the refresh the lending market wants before anyone reads a loan to value. */
export async function refreshTheMarket(world: World, obligation: string): Promise<void> {
  for (const reserve of [world.collateral, world.borrow]) {
    await world.sendExpectingSuccess(
      getRefreshReserveInstruction({
        reserve: reserve.address,
        lendingMarket: world.market,
        scopePrices: world.scopePrices,
      }),
      world.keeper,
      'refresh_reserve',
    );
  }

  const refreshObligation = getRefreshObligationInstruction({
    lendingMarket: world.market,
    obligation: obligation as Parameters<
      typeof getRefreshObligationInstruction
    >[0]['obligation'],
  });
  await world.sendExpectingSuccess(
    {
      ...refreshObligation,
      accounts: [
        ...refreshObligation.accounts,
        { address: world.collateral.address, role: AccountRole.WRITABLE },
        { address: world.borrow.address, role: AccountRole.WRITABLE },
      ],
    },
    world.keeper,
    'refresh_obligation',
  );
  world.reloadReserves();
}

function readTheMarket(world: World, opened: OpenedPosition): MarketReading {
  return {
    obligation: world.obligation(opened.obligation),
    collateralReserve: world.collateral.snapshot,
    borrowReserve: world.borrow.snapshot,
    borrowReserveAddress: world.borrow.address,
    usdcPrice: world.scopePrice(world.borrow.snapshot.scopeFeedIndex),
    currentSlot: world.slot,
  };
}

/**
 * One round's worth of candidates, built through the keeper's own mapping from what the chain
 * says, so the decision the test exercises is the decision the keeper would make.
 */
export async function buildTheRound(
  world: World,
  opened: OpenedPosition,
): Promise<Round<GuardSubject>> {
  await refreshTheMarket(world, opened.obligation);

  const config = world.config();
  const collateralEntry = config.allowedCollateral.find(
    (entry) => entry.mint === world.collateral.snapshot.liquidityMint,
  );
  const destination = config.allowedDestinations.find(
    (entry) => entry.mint === world.destinationMint,
  );
  if (collateralEntry === undefined || destination === undefined) {
    throw new Error('the config in this world does not allow the pair under test');
  }

  return {
    limits: {
      minProtectIntervalSeconds: Number(config.minProtectIntervalSeconds),
      minGrowIntervalSeconds: Number(config.minGrowIntervalSeconds),
      maxPriceAgeSlots: Number(config.maxPriceAgeSlots),
      growPaused: config.growPaused,
      sunset: config.sunset,
    },
    unixTimestamp: Number(world.unixTimestamp),
    candidates: [
      watchThePosition({
        positionAddress: opened.address,
        position: positionAccount(world, opened.address),
        collateralEntry,
        destination,
        market: readTheMarket(world, opened),
        destinationPrice: world.scopePrice(ONYC_SCOPE_FEED_INDEX),
        destinationDecimals: DESTINATION_DECIMALS,
        destinationBalance: world.tokenBalance(opened.tokens.positionDestination),
      }),
    ],
  };
}

export interface SentTransactions {
  readonly send: (instruction: Instruction) => Promise<string>;
  readonly landed: Landed[];
}

/** Stands in for the keeper's sender: the same instruction, sent into this world. */
export function createLiteSvmSender(world: World): SentTransactions {
  const landed: Landed[] = [];
  return {
    landed,
    async send(instruction: Instruction): Promise<string> {
      const result = await world.send(instruction, world.keeper);
      if ('err' in result) {
        throw new Error(reasonFor(result));
      }
      landed.push(result);
      return `landed in ${result.computeUnits} compute units`;
    },
  };
}
