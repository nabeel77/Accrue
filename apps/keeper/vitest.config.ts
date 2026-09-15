import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'keeper',
    include: ['src/**/*.test.ts'],
  },
});
