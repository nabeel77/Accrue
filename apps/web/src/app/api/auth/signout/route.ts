import { ok } from '../../../../server/respond.js';
import { endSession } from '../../../../server/session.js';

export async function POST(): Promise<Response> {
  await endSession();
  return ok({ signedOut: true });
}
