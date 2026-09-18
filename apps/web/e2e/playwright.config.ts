import { defineConfig } from '@playwright/test';

import { WEB_URL } from './config.js';

const A_GENEROUS_TWELVE_MINUTES = 720_000;
const A_PATIENT_THREE_MINUTES = 180_000;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: A_GENEROUS_TWELVE_MINUTES,
  reporter: [['list']],
  globalSetup: './globalSetup.ts',
  globalTeardown: './globalTeardown.ts',
  use: {
    baseURL: WEB_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'landing', testMatch: /landing\.spec\.ts/u },
    { name: 'errors', testMatch: /errors\.spec\.ts/u, timeout: A_PATIENT_THREE_MINUTES },
    { name: 'app', testMatch: /app\.spec\.ts/u },
    { name: 'rescue', testMatch: /rescue\.spec\.ts/u, dependencies: ['app'] },
  ],
});
