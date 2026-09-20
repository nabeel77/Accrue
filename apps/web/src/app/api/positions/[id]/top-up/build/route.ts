import { z } from 'zod';

import { buildTopUp } from '../../../../../../server/positions/buildTopUp.js';
import { answerAnOwnerAction } from '../../../../../../server/positions/ownerRoute.js';
import { readBody } from '../../../../../../server/respond.js';

const body = z.object({ amountRaw: z.string().regex(/^\d{1,20}$/u) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = await readBody(request, body);
  if ('response' in parsed) {
    return parsed.response;
  }
  const { id } = await context.params;
  // The position comes from the session wallet and the row, never from the browser.
  return answerAnOwnerAction('positions/top-up/build', id, async ({ inputs, steps }) => {
    const outcome = await buildTopUp(
      { ...inputs, collateralAmountRaw: BigInt(parsed.value.amountRaw) },
      steps,
    );
    return 'refused' in outcome
      ? outcome
      : { built: outcome.built, extra: { summary: outcome.summary } };
  });
}
