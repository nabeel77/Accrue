import { reportStep } from './shared.js';

const DEFAULT_APP_URL = 'http://127.0.0.1:3000';
const DEFAULT_EVERY_SECONDS = 15;
const A_SECOND = 1_000;

const ROUTES = [
  'guard-events',
  'position-snapshot',
  'market-snapshot',
  'destination-snapshot',
  'abandon-builds',
] as const;

function appUrl(): string {
  return process.env['ACCRUE_APP_URL'] ?? DEFAULT_APP_URL;
}

async function callOne(route: string, secret: string): Promise<string> {
  const answer = await fetch(`${appUrl()}/api/cron/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
    body: '{}',
  });
  const body = await answer.text();
  return `${answer.status} ${body.slice(0, 160)}`;
}

async function main(): Promise<void> {
  const secret = process.env['CRON_SECRET'] ?? '';
  if (secret === '') {
    throw new Error('CRON_SECRET is not set, so every cron route would refuse this.');
  }
  const everySeconds = Number(
    process.env['DEVNET_CRON_SECONDS'] ?? DEFAULT_EVERY_SECONDS,
  );
  reportStep(
    `calling ${ROUTES.length} cron routes on ${appUrl()} every ${everySeconds}s`,
  );

  for (;;) {
    const startedAt = Date.now();
    for (const route of ROUTES) {
      try {
        reportStep(`  ${route.padEnd(22)}${await callOne(route, secret)}`);
      } catch (failure) {
        reportStep(
          `  ${route.padEnd(22)}did not answer: ${failure instanceof Error ? failure.message : 'unknown'}`,
        );
      }
    }
    await new Promise((wake) =>
      setTimeout(wake, Math.max(0, everySeconds * A_SECOND - (Date.now() - startedAt))),
    );
  }
}

await main();
