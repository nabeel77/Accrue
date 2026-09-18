import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import nextEnv from '@next/env';

import { screenshotDirectory } from './config.js';
import { startTheRescuePage, startTheWebApp } from './servers.js';

export default async function globalSetup(): Promise<void> {
  // The harness reads the laptop file for its own wallet and folder, and the app's own file for
  // everything the server needs. Neither one can see the other's variables in a deployment.
  const here = resolve(new URL('.', import.meta.url).pathname);
  nextEnv.loadEnvConfig(resolve(here, '../../..'));
  nextEnv.loadEnvConfig(resolve(here, '..'));
  await mkdir(screenshotDirectory(), { recursive: true });
  const rescue = await startTheRescuePage();
  const web = await startTheWebApp();
  process.env['E2E_RESCUE_PID'] = `${rescue.pid}`;
  process.env['E2E_WEB_PID'] = `${web.pid}`;
}
