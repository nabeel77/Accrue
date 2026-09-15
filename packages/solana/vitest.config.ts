import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'solana',
    include: ['src/**/*.test.ts'],
    exclude: ['src/program/**'],
  },
});
