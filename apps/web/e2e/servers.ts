import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import { RESCUE_PORT, RESCUE_URL, WEB_PORT, WEB_URL } from './config.js';

const START_TIMEOUT_MILLISECONDS = 180_000;
const POLL_MILLISECONDS = 500;

const here = resolve(new URL('.', import.meta.url).pathname);
const webRoot = resolve(here, '..');
const rescueDistribution = resolve(webRoot, '../rescue/dist');

async function waitUntilItAnswers(url: string): Promise<void> {
  const until = Date.now() + START_TIMEOUT_MILLISECONDS;
  while (Date.now() < until) {
    try {
      const answer = await fetch(url);
      if (answer.status < 500) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((wake) => setTimeout(wake, POLL_MILLISECONDS));
  }
  throw new Error(`${url} never answered`);
}

export async function startTheWebApp(): Promise<ChildProcess> {
  const child = spawn(
    resolve(webRoot, 'node_modules/.bin/next'),
    ['dev', '--port', `${WEB_PORT}`],
    { cwd: webRoot, stdio: 'inherit', env: process.env, detached: true },
  );
  await waitUntilItAnswers(`${WEB_URL}/api/me`);
  return child;
}

export async function startTheRescuePage(): Promise<ChildProcess> {
  const child = spawn(
    'python3',
    [
      '-m',
      'http.server',
      `${RESCUE_PORT}`,
      '--bind',
      '127.0.0.1',
      '--directory',
      rescueDistribution,
    ],
    { cwd: webRoot, stdio: 'ignore', detached: true },
  );
  await waitUntilItAnswers(RESCUE_URL);
  return child;
}

export function stopIt(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }
}

export async function itStillAnswers(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}
