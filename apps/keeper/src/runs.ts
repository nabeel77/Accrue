import { createDatabaseClient, schema, type AccrueDatabase } from '@accrue/db';

import type { GuardAction } from './decide.js';

export type Outcome = 'landed' | 'reverted' | 'skipped';

export interface AttemptedRun {
  readonly positionAddress: string;
  // A check is a round that looked at this position and found nothing to do.
  readonly kind: GuardAction | 'check';
  readonly outcome: Outcome;
  readonly signature: string | null;
  readonly reason: string | null;
  readonly durationMs: number;
}

export interface RunLog {
  record(run: AttemptedRun): Promise<void>;
}

export function createRunLog(
  keeperAddress: string,
  database: AccrueDatabase = createDatabaseClient(),
): RunLog {
  return {
    async record(run: AttemptedRun): Promise<void> {
      await database.insert(schema.keeperRuns).values({
        positionAddress: run.positionAddress,
        keeperAddress,
        kind: run.kind,
        outcome: run.outcome,
        signature: run.signature,
        reason: run.reason,
        durationMs: run.durationMs,
      });
    },
  };
}

export function runLogFromTheEnvironment(keeperAddress: string): RunLog {
  const connectionString = process.env['DATABASE_URL'];
  return connectionString === undefined || connectionString === ''
    ? createRunLogThatOnlyCounts()
    : createRunLog(keeperAddress);
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
