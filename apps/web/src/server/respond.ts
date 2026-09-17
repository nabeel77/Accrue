import 'server-only';

import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

/** Every route answers with an explicit shape, never a raw database row. */
export function ok(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function refuse(
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Try again in a moment.' },
    { status: 429, headers: { 'retry-after': `${retryAfterSeconds}` } },
  );
}

/** Reads and validates a JSON body, or answers 400 without saying anything about the caller. */
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
  return reasons.length === 0 ? 'no reason given' : reasons.join(' <- ');
}

/** Never a stack trace, never another wallet, never an internal identifier. */
export function somethingWentWrong(failure?: unknown): NextResponse {
  if (failure !== undefined) {
    console.error(`a route could not answer: ${whyItFailed(failure)}`);
  }
  return refuse('Something went wrong reading the chain. Try again.', 502);
}
