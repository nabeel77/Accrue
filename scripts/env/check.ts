import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

const repositoryRoot = resolve(import.meta.dirname, '../..');

const FILES = ['.env', 'apps/web/.env', 'apps/keeper/.env'] as const;

const PLACEHOLDERS = ['[project]', '[password]', '[region]', '<', 'changeme', 'TODO'];

// An error message can carry a host or a user, so only the kind of failure is ever printed.
function whyItFailed(failure: unknown): string {
  if (!(failure instanceof Error)) {
    return 'unknown';
  }
  const code = (failure as { code?: string }).code;
  if (code !== undefined) {
    return code;
  }
  const firstWords = failure.message.split(/[\s:]/u).slice(0, 2).join(' ');
  return firstWords === '' ? 'unknown' : firstWords;
}

// The router answers without a key, slower, so an empty one is a choice rather than a gap.
const MAY_BE_EMPTY = ['JUPITER_API_KEY'];

interface Loaded {
  readonly file: string;
  readonly values: Map<string, string>;
}

function load(file: string): Loaded | null {
  const path = resolve(repositoryRoot, file);
  if (!existsSync(path)) {
    return null;
  }
  const values = new Map<string, string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0 || line.startsWith('#')) {
      continue;
    }
    values.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return { file, values };
}

function namesTheExampleWants(file: string): string[] {
  const path = resolve(repositoryRoot, `${file}.example`);
  const names: string[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0 && !line.startsWith('#')) {
      names.push(line.slice(0, at).trim());
    }
  }
  return names;
}

function looksLikeAPlaceholder(value: string): boolean {
  return PLACEHOLDERS.some((mark) => value.includes(mark));
}

// Names only, never a value: this prints in a terminal somebody else may be looking at.
function report(loaded: Loaded): { missing: number } {
  let missing = 0;
  for (const name of namesTheExampleWants(loaded.file)) {
    const value = loaded.values.get(name);
    if (value === undefined) {
      console.log(`  ${name} is missing`);
      missing += 1;
    } else if (value === '') {
      if (MAY_BE_EMPTY.includes(name)) {
        continue;
      }
      console.log(`  ${name} is empty`);
      missing += 1;
    } else if (looksLikeAPlaceholder(value)) {
      console.log(`  ${name} is still the example placeholder`);
      missing += 1;
    }
  }
  return { missing };
}

const POOLER_HOST = '.pooler.supabase.com';
const TRANSACTION_POOLER_PORT = '6543';

// The shape of a connection string, said without any part of it.
function whatIsWrongWithTheShape(label: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'that is not a connection string';
  }
  const pooled = parsed.hostname.endsWith(POOLER_HOST);
  if (pooled && !parsed.username.includes('.')) {
    return 'a pooler needs the project reference in the user name, postgres.<ref>';
  }
  if (label === 'DATABASE_URL' && parsed.port !== TRANSACTION_POOLER_PORT) {
    return 'the app wants the transaction pooler, which is port 6543';
  }
  if (
    label === 'DATABASE_DIRECT_URL' &&
    pooled &&
    parsed.port === TRANSACTION_POOLER_PORT
  ) {
    return 'migrations want the direct connection or the session pooler, which is port 5432';
  }
  return null;
}

async function theDatabaseAnswers(
  label: string,
  url: string | undefined,
): Promise<boolean> {
  if (url === undefined || url === '' || looksLikeAPlaceholder(url)) {
    console.log(`  ${label} is not set, so nothing was asked of it`);
    return false;
  }
  const shape = whatIsWrongWithTheShape(label, url);
  if (shape !== null) {
    console.log(`  ${label} is the wrong shape: ${shape}`);
    return false;
  }
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    await sql`select 1`;
    console.log(`  ${label} answers select 1`);
    return true;
  } catch (failure) {
    const why = whyItFailed(failure);
    const hint =
      why === 'ENOTFOUND' && !url.includes(POOLER_HOST)
        ? '. That host is reachable over IPv6 only, so use the session pooler on port 5432'
        : '';
    console.log(`  ${label} did not answer: ${why}${hint}`);
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function theRpcAnswers(url: string | undefined): Promise<boolean> {
  if (url === undefined || url === '' || looksLikeAPlaceholder(url)) {
    console.log('  HELIUS_RPC_URL is not set, so nothing was asked of it');
    return false;
  }
  try {
    const answer = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    const body = (await answer.json()) as { result?: string };
    const healthy = body.result === 'ok';
    console.log(
      healthy ? '  HELIUS_RPC_URL answers getHealth' : '  HELIUS_RPC_URL is not healthy',
    );
    return healthy;
  } catch (failure) {
    console.log(`  HELIUS_RPC_URL did not answer: ${whyItFailed(failure)}`);
    return false;
  }
}

async function main(): Promise<void> {
  let wrong = 0;
  const loadedFiles: Loaded[] = [];

  for (const file of FILES) {
    const loaded = load(file);
    console.log(file);
    if (loaded === null) {
      console.log('  is not there. Run pnpm env:init.');
      wrong += 1;
      continue;
    }
    loadedFiles.push(loaded);
    const { missing } = report(loaded);
    if (missing === 0) {
      console.log('  every variable the example names has a value');
    }
    wrong += missing;
    console.log('');
  }

  const anyValue = (name: string): string | undefined => {
    for (const loaded of loadedFiles) {
      const value = loaded.values.get(name);
      if (value !== undefined && value !== '') {
        return value;
      }
    }
    return undefined;
  };

  console.log('what answers');
  const pooled = await theDatabaseAnswers('DATABASE_URL', anyValue('DATABASE_URL'));
  const direct = await theDatabaseAnswers(
    'DATABASE_DIRECT_URL',
    anyValue('DATABASE_DIRECT_URL'),
  );
  const rpc = await theRpcAnswers(anyValue('HELIUS_RPC_URL'));

  const everythingAnswers = pooled && direct && rpc;
  console.log('');
  if (wrong === 0 && everythingAnswers) {
    console.log('everything is set and everything answers');
    return;
  }
  if (wrong > 0) {
    console.log(`${wrong} variables still need a value`);
  }
  if (!everythingAnswers) {
    console.log('something did not answer');
  }
  process.exitCode = 1;
}

await main();
