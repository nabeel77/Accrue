import { defineConfig } from '@playwright/test';

import { WEB_URL } from './config.js';

const A_GENEROUS_MINUTE = 180_000;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: A_GENEROUS_MINUTE,
  reporter: [['list']],
  globalSetup: './globalSetup.ts',
  globalTeardown: './globalTeardown.ts',
  use: {
    baseURL: WEB_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'app', testMatch: /app\.spec\.ts/u },
    { name: 'rescue', testMatch: /rescue\.spec\.ts/u, dependencies: ['app'] },
  ],
});
