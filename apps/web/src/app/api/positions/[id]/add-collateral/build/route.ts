import { z } from 'zod';

import { buildAddCollateral } from '../../../../../../server/positions/buildOwnerAction.js';
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
  return answerAnOwnerAction('positions/add-collateral/build', id, async ({ inputs }) =>
    buildAddCollateral({
      ...inputs,
      collateralAmountRaw: BigInt(parsed.value.amountRaw),
    }),
  );
}
