import type { Instruction } from '@solana/kit';

import {
  decideWhatToDo,
  mostStretchedFirst,
  type Decision,
  type GuardLimits,
  type PositionUnderWatch,
} from './decide.js';
import { shortenAddress } from './logging.js';
import type { RunLog } from './runs.js';

/**
 * What the round carries about one position: what the decision needs, and the `subject` the
 * builder needs to assemble the call. The loop itself never looks inside the subject.
 */
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

/**
 * The keeper only proposes. Every condition is checked again on chain, so a wrong decision here
 * costs the keeper a fee and never costs an owner anything.
 */
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
    if (decision.kind === 'wait') {
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
      const reason = failure instanceof Error ? failure.message : 'unknown';
      await runLog.record({
        positionAddress: candidate.address,
        kind: decision.kind,
        outcome: 'reverted',
        signature: null,
        reason,
        durationMs: Date.now() - startedAt,
      });
      report(
        `${decision.kind} reverted on ${shortenAddress(candidate.address)}: ${reason}`,
      );
    }
  }

  return { considered: round.candidates.length, attempted, landed };
}

export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1_000);
  });
}
