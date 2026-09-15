import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(import.meta.dirname, '../..'),
  test: {
    name: 'anchor',
    include: ['tests/anchor/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
