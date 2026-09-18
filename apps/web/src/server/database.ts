import 'server-only';

import { createDatabaseClient, type AccrueDatabase } from '@accrue/db';

let shared: AccrueDatabase | null = null;

// One pool for the whole server. A client per module or per request runs the database out of them.
export function db(): AccrueDatabase {
  shared ??= createDatabaseClient();
  return shared;
}
