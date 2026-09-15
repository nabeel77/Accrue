import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Run by `anchor test`, against the validator Anchor deploys to. Deliberately outside the
 * root projects list so the fast suite never needs a validator.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, '../..'),
  test: {
    name: 'anchor',
    include: ['tests/anchor/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
