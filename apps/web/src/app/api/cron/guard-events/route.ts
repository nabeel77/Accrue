import { catchUpOnGuardEvents } from '../../../../server/guardEvents.js';
import { cronIsAuthorised } from '../../../../server/cron.js';
import { ok, refuse, somethingWentWrong } from '../../../../server/respond.js';

export async function POST(request: Request): Promise<Response> {
  if (!cronIsAuthorised(request)) {
    return refuse('No.', 401);
  }
  try {
    return ok({ written: await catchUpOnGuardEvents() });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
