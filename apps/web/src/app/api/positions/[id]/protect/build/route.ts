import { buildProtectByOwner } from '../../../../../../server/positions/buildOwnerAction.js';
import { answerAnOwnerAction } from '../../../../../../server/positions/ownerRoute.js';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return answerAnOwnerAction('positions/protect/build', id, async ({ inputs }) =>
    buildProtectByOwner(inputs),
  );
}
