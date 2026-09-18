import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

// What the wallet on the other end of this request can read. It belongs to the request, not to
// this process, so it is held per request rather than in a variable two callers would share. A
// build with nobody on the other end, in a script, assumes nothing.
const forThisRequest = new AsyncLocalStorage<{ readonly takesVersionOne: boolean }>();

export function whileTheCallerIsKnown<Answer>(
  takesVersionOne: boolean,
  work: () => Promise<Answer>,
): Promise<Answer> {
  return forThisRequest.run({ takesVersionOne }, work);
}

export function theCallerTakesVersionOne(): boolean {
  return forThisRequest.getStore()?.takesVersionOne ?? false;
}
