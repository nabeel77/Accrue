import { createDatabaseClient, schema, type AccrueDatabase } from '@accrue/db';

import type { GuardAction } from './decide.js';

export type Outcome = 'landed' | 'reverted' | 'skipped';

export interface AttemptedRun {
  readonly positionAddress: string;
  readonly kind: GuardAction;
  readonly outcome: Outcome;
  readonly signature: string | null;
  readonly reason: string | null;
  readonly durationMs: number;
}

export interface RunLog {
  record(run: AttemptedRun): Promise<void>;
}

/**
 * One row per attempt, with nothing about the owner beyond the position address, which is public
 * on chain anyway. Never the route, never a wallet.
 */
export function createRunLog(database: AccrueDatabase = createDatabaseClient()): RunLog {
  return {
    async record(run: AttemptedRun): Promise<void> {
      await database.insert(schema.keeperRuns).values({
        positionAddress: run.positionAddress,
        kind: run.kind,
        outcome: run.outcome,
        signature: run.signature,
        reason: run.reason,
        durationMs: run.durationMs,
      });
    },
  };
}

export function createRunLogThatOnlyCounts(): RunLog & {
  readonly recorded: AttemptedRun[];
} {
  const recorded: AttemptedRun[] = [];
  return {
    recorded,
    record(run: AttemptedRun): Promise<void> {
      recorded.push(run);
      return Promise.resolve();
    },
  };
}
