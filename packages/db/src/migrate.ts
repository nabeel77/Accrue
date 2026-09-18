import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createMigrationClient } from './connection.js';
import { loadTheRootEnvironment } from './rootEnvironment.js';

loadTheRootEnvironment();

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

async function applyMigrations(): Promise<void> {
  const sql = createMigrationClient();
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    console.log(`Applied migrations from ${migrationsFolder}`);
  } finally {
    await sql.end();
  }
}

await applyMigrations();
