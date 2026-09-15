import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'keeper-rounds',
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
