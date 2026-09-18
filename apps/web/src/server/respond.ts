import 'server-only';

import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

import { shortenEveryAddress } from '@accrue/core';

import type { FailureCode } from '../copy/errors.js';

// Every route answers with an explicit shape, never a raw database row.
export function ok(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

// The code is what the browser reads. The message is for the log and never for a screen.
export function refuse(
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function refuseWith(
  failure: FailureCode,
  status: number,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ failure, ...extra }, { status });
}

export function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { failure: 'rateLimited', retryAfterSeconds },
    { status: 429, headers: { 'retry-after': `${retryAfterSeconds}` } },
  );
}

// Reads and validates a JSON body, or answers 400 without saying anything about the caller.
export async function readBody<Shape>(
  request: Request,
  schema: ZodType<Shape>,
): Promise<{ value: Shape } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: refuse('That request body is not JSON.', 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      response: refuse('That request is not in the shape this route takes.', 400),
    };
  }
  return { value: parsed.data };
}

export function readQuery<Shape>(
  request: Request,
  schema: ZodType<Shape>,
): { value: Shape } | { response: NextResponse } {
  const entries = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(entries);
  if (!parsed.success) {
    return {
      response: refuse('That request is not in the shape this route takes.', 400),
    };
  }
  return { value: parsed.data };
}

function whyItFailed(failure: unknown): string {
  const reasons: string[] = [];
  let current = failure;
  while (current instanceof Error && reasons.length < 5) {
    reasons.push(current.message);
    current = current.cause;
  }
  return reasons.length === 0
    ? 'no reason given'
    : shortenEveryAddress(reasons.join(' <- '));
}

// Never a stack trace, never another wallet, never an internal identifier. In development the
// reason rides along so the browser console has it too; a deployment sends the sentence alone.
export function somethingWentWrong(failure?: unknown): NextResponse {
  if (failure === undefined) {
    return refuseWith('somethingWentWrong', 502);
  }
  const why = whyItFailed(failure);
  console.error(`a route could not answer: ${why}`);
  return refuseWith(
    'somethingWentWrong',
    502,
    process.env.NODE_ENV === 'production' ? {} : { because: why },
  );
}
