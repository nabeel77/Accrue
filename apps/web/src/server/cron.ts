import 'server-only';

import { required } from './env.js';

/** Every cron route is behind the same header and answers nothing without it. */
export function cronIsAuthorised(request: Request): boolean {
  const given = request.headers.get('x-cron-secret') ?? '';
  const expected = required('CRON_SECRET');
  return given.length === expected.length && given === expected;
}
