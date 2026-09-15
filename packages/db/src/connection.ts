import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type AccrueDatabase = ReturnType<typeof createDatabaseClient>;

function requireConnectionString(
  variableName: 'DATABASE_URL' | 'DATABASE_DIRECT_URL',
): string {
  const connectionString = process.env[variableName];
  if (!connectionString) {
    throw new Error(`${variableName} is not set. See .env.example.`);
  }
  return connectionString;
}

/**
 * Runtime client on the pooled connection string. Server only: the browser never holds
 * this string and never talks to the database.
 */
export function createDatabaseClient(): ReturnType<typeof drizzle<typeof schema>> {
  const sql = postgres(requireConnectionString('DATABASE_URL'), { prepare: false });
  return drizzle(sql, { schema });
}

/** Migrations run on the direct connection string, never the pooled one. */
export function createMigrationClient(): ReturnType<typeof postgres> {
  return postgres(requireConnectionString('DATABASE_DIRECT_URL'), { max: 1 });
}
