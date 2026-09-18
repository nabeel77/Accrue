import type { Instruction } from '@solana/kit';

import {
  decideWhatToDo,
  mostStretchedFirst,
  type Decision,
  type GuardLimits,
  type PositionUnderWatch,
} from './decide.js';
import { shortenAddress, shortenEveryAddress } from './logging.js';
import type { RunLog } from './runs.js';

export interface Candidate<Subject> {
  readonly address: string;
  readonly loanToValueBps: number;
  readonly watched: PositionUnderWatch;
  readonly subject: Subject;
}

export interface Round<Subject> {
  readonly limits: GuardLimits;
  readonly unixTimestamp: number;
  readonly candidates: readonly Candidate<Subject>[];
}

export interface GuardInstructionBuilder<Subject> {
  build(candidate: Candidate<Subject>, decision: Decision): Promise<Instruction>;
}

export interface RoundReport {
  readonly considered: number;
  readonly attempted: number;
  readonly landed: number;
}

// The keeper only proposes.
export async function runOneRound<Subject>(
  round: Round<Subject>,
  builder: GuardInstructionBuilder<Subject>,
  send: (instruction: Instruction) => Promise<string>,
  runLog: RunLog,
  report: (line: string) => void,
): Promise<RoundReport> {
  let attempted = 0;
  let landed = 0;

  for (const candidate of mostStretchedFirst([...round.candidates])) {
    const decision = decideWhatToDo(candidate.watched, round.limits, {
      unixTimestamp: round.unixTimestamp,
    });
    // A round that looked and found nothing to do is still a round, and it is the only way a
    // screen can say the guard is being run at all.
    if (decision.kind === 'wait') {
      await runLog.record({
        positionAddress: candidate.address,
        kind: 'check',
        outcome: 'skipped',
        signature: null,
        reason: decision.reason,
        durationMs: 0,
      });
      continue;
    }

    attempted += 1;
    const startedAt = Date.now();
    try {
      const instruction = await builder.build(candidate, decision);
      const signature = await send(instruction);
      landed += 1;
      await runLog.record({
        positionAddress: candidate.address,
        kind: decision.kind,
        outcome: 'landed',
        signature,
        reason: null,
        durationMs: Date.now() - startedAt,
      });
      report(`${decision.kind} landed on ${shortenAddress(candidate.address)}`);
    } catch (failure) {
      const reason = whyItFailed(failure);
      await runLog.record({
        positionAddress: candidate.address,
        kind: decision.kind,
        outcome: 'reverted',
        signature: null,
        reason,
        durationMs: Date.now() - startedAt,
      });
      report(
        shortenEveryAddress(
          `${decision.kind} reverted on ${shortenAddress(candidate.address)}: ${reason}`,
        ),
      );
    }
  }

  return { considered: round.candidates.length, attempted, landed };
}

function whyItFailed(failure: unknown): string {
  const reasons: string[] = [];
  let current: unknown = failure;
  while (current instanceof Error && reasons.length < 4) {
    reasons.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return reasons.length === 0 ? 'unknown' : reasons.join(': ');
}

export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1_000);
  });
}
