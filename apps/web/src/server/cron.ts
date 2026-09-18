import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { required } from './env.js';

// Every cron route is behind the same header, compared in constant time.
export function cronIsAuthorised(request: Request): boolean {
  const given = Buffer.from(request.headers.get('x-cron-secret') ?? '');
  const expected = Buffer.from(required('CRON_SECRET'));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
