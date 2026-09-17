import { stopIt } from './servers.js';

export default function globalTeardown(): void {
  stopIt(Number(process.env['E2E_WEB_PID']) || undefined);
  stopIt(Number(process.env['E2E_RESCUE_PID']) || undefined);
}
