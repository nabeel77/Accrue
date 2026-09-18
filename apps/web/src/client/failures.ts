'use client';

import {
  FAILURE_COPY,
  FAILURE_DETAILS,
  failureCodeOf,
  sentenceWithTheNumbers,
  type FailureCode,
} from '../copy/errors.js';

export interface FailureAnswer {
  readonly failure?: string;
  readonly refusal?: string;
  readonly message?: string;
  readonly retryAfterSeconds?: number;
  readonly detail?: Record<string, string | number>;
  // Development only: the reason the server could not answer, addresses already shortened.
  readonly because?: string;
  // What was asked and what came back, filled in here rather than by the server.
  readonly route?: string;
  readonly status?: number;
  readonly steps?: unknown;
}

export interface ReadableFailure {
  readonly code: FailureCode;
  readonly sentence: string;
}

// The wallet says no in a dozen ways, and every one of them means the same thing to a reader.
const REJECTION_WORDS = ['reject', 'declin', 'denied', 'cancel', 'user closed'];

export function theWalletSaidNo(failure: unknown): boolean {
  const said = failure instanceof Error ? failure.message.toLowerCase() : '';
  return REJECTION_WORDS.some((word) => said.includes(word));
}

function pathOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

export async function readTheAnswer<Shape>(
  response: Response,
): Promise<Shape & FailureAnswer> {
  const body = await response.text();
  const where = { route: pathOf(response.url), status: response.status };
  try {
    return { ...where, ...(JSON.parse(body) as Shape & FailureAnswer) };
  } catch {
    return {
      ...where,
      failure: 'somethingWentWrong',
      because: `the route answered ${response.status} with ${body.slice(0, 200)}`,
    } as Shape & FailureAnswer;
  }
}

export function readFailure(answer: FailureAnswer | null): ReadableFailure | null {
  if (answer === null) {
    return null;
  }
  const code = failureCodeOf(answer);
  sayItInTheConsole(answer, code);
  if (code === null) {
    return null;
  }
  return { code, sentence: sentenceFor(code, answer) };
}

function sayItInTheConsole(answer: FailureAnswer, code: FailureCode | null): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  const named = answer.failure ?? answer.refusal ?? null;
  console.error(
    `accrue: ${answer.route ?? 'a route'} answered ${answer.status ?? '?'} ${named ?? 'with no name'}${
      answer.because === undefined ? '' : ` because ${answer.because}`
    }`,
    {
      code,
      named,
      message: answer.message ?? null,
      because: answer.because ?? null,
      detail: answer.detail ?? null,
      steps: answer.steps ?? null,
    },
  );
}

function sentenceFor(code: FailureCode, answer: FailureAnswer): string {
  if (code === 'rateLimited' && answer.retryAfterSeconds !== undefined) {
    return `${FAILURE_COPY[code]} ${FAILURE_DETAILS.rateLimitedRetry(
      `${answer.retryAfterSeconds}`,
    )}`;
  }
  return sentenceWithTheNumbers(code, answer.detail) ?? FAILURE_COPY[code];
}

export function failureOf(code: FailureCode, thrown?: unknown): ReadableFailure {
  if (process.env.NODE_ENV !== 'production') {
    console.error('accrue stopped here', { code, thrown: thrown ?? null });
  }
  return { code, sentence: FAILURE_COPY[code] };
}

export class SubmissionRefused extends Error {
  constructor(readonly failure: ReadableFailure) {
    super(failure.code);
    this.name = 'SubmissionRefused';
  }
}
