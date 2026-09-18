import { defineConfig } from '@playwright/test';

import { WEB_URL } from './config.js';

const A_GENEROUS_MINUTE = 180_000;

export default defineConfig({
  testDir: '.',
  workers: 1,
  timeout: A_GENEROUS_MINUTE,
  reporter: [['list']],
  globalSetup: './globalSetup.ts',
  globalTeardown: './globalTeardown.ts',
  use: { baseURL: WEB_URL, headless: true, viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'close', testMatch: /close\.spec\.ts/u }],
});
