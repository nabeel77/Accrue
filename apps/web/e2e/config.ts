import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 3100);
export const RESCUE_PORT = Number(process.env['E2E_RESCUE_PORT'] ?? 8180);
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const RESCUE_URL = `http://127.0.0.1:${RESCUE_PORT}`;

export const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 375, height: 812 },
] as const;

export function screenshotDirectory(): string {
  const chosen = process.env['E2E_SCREENSHOT_DIR'];
  if (chosen === undefined || chosen === '') {
    throw new Error('E2E_SCREENSHOT_DIR is not set. See .env.example.');
  }
  return chosen.startsWith('~') ? resolve(homedir(), chosen.slice(2)) : resolve(chosen);
}
