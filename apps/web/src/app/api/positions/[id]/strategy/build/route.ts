import { z } from 'zod';

import { buildSetStrategy } from '../../../../../../server/positions/buildOwnerAction.js';
import { answerAnOwnerAction } from '../../../../../../server/positions/ownerRoute.js';
import { readBody } from '../../../../../../server/respond.js';

const body = z.object({
  targetLtvBps: z.number().int().min(1).max(9_000),
  protectLtvBps: z.number().int().min(1).max(9_500),
  growBelowLtvBps: z.number().int().min(0).max(9_000),
  growEnabled: z.boolean(),
  exitOnFlagEnabled: z.boolean(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = await readBody(request, body);
  if ('response' in parsed) {
    return parsed.response;
  }
  const { id } = await context.params;
  return answerAnOwnerAction('positions/strategy/build', id, async ({ inputs }) =>
    buildSetStrategy({ ...inputs, strategy: parsed.value }),
  );
}
