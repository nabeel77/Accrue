import { z } from 'zod';

import {
  buildRepay,
  buildRepayAndClose,
} from '../../../../../../server/positions/buildOwnerAction.js';
import { answerAnOwnerAction } from '../../../../../../server/positions/ownerRoute.js';
import { readBody } from '../../../../../../server/respond.js';

const body = z.object({
  amountRaw: z
    .string()
    .regex(/^\d{1,20}$/u)
    .optional(),
  andClose: z.boolean().optional(),
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
  return answerAnOwnerAction('positions/repay/build', id, async ({ inputs }) =>
    parsed.value.andClose === true
      ? buildRepayAndClose(inputs)
      : buildRepay({
          ...inputs,
          requestedAmountRaw: BigInt(parsed.value.amountRaw ?? '0'),
        }),
  );
}
