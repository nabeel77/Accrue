import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');

const FILES = ['.env', 'apps/web/.env', 'apps/keeper/.env'] as const;

// Only three values cannot be worked out here, and each one says where it comes from.
const WHERE_TO_GET_IT: Readonly<Record<string, string>> = {
  DATABASE_URL:
    'Supabase Transaction pooler, port 6543 on aws-0-<region>.pooler.supabase.com. Not the Session pooler: the app runs without prepared statements.',
  DATABASE_DIRECT_URL:
    'Supabase Direct connection, port 5432 on db.<ref>.supabase.co. Migrations run over this one. On a network without IPv6 use the Session pooler instead, also port 5432.',
  HELIUS_RPC_URL:
    'A devnet endpoint, https://devnet.helius-rpc.com/?api-key=... while SOLANA_CLUSTER is devnet.',
};

// Empty on purpose, with a line of its own saying so.
const YOURS_IF_YOU_WANT_IT: Readonly<Record<string, string>> = {
  JUPITER_API_KEY:
    'A Jupiter key raises the quote rate limit on mainnet. The router answers without one.',
};

function noteFor(name: string): string {
  const optional = YOURS_IF_YOU_WANT_IT[name];
  if (optional !== undefined) {
    return `# Optional, yours if you want it. ${optional}`;
  }
  const needed = WHERE_TO_GET_IT[name];
  return needed === undefined ? '# Needed from you.' : `# Needed from you. ${needed}`;
}

function secret(): string {
  return randomBytes(32).toString('base64url');
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: readonly number[]): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let out = '';
  while (value > 0n) {
    out = `${BASE58[Number(value % 58n)] ?? ''}${out}`;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    out = `1${out}`;
  }
  return out;
}

function theAdminAddress(): string | null {
  const path = resolve(homedir(), '.config/solana/id.json');
  if (!existsSync(path)) {
    return null;
  }
  try {
    const bytes = JSON.parse(readFileSync(path, 'utf8')) as number[];
    return base58(bytes.slice(32));
  } catch {
    return null;
  }
}

function theBuildHash(): string | null {
  const path = resolve(repositoryRoot, 'target/deploy/accrue.so');
  if (!existsSync(path)) {
    return null;
  }
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fromTheDevnetRegistry(key: string): string | null {
  const path = resolve(homedir(), '.config/accrue/devnet/addresses.json');
  if (!existsSync(path)) {
    return null;
  }
  try {
    const registry = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const value = registry[key];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

const faucetSecret = secret();

const FILLED: Readonly<Record<string, string>> = {
  SOLANA_CLUSTER: 'devnet',
  HELIUS_MAX_REQUESTS_PER_SECOND: '20',

  SESSION_SECRET: secret(),
  SESSION_TTL_DAYS: '7',
  AUTH_NONCE_TTL_MINUTES: '5',
  AUTH_DOMAIN: 'localhost:3000',
  CRON_SECRET: secret(),

  DEVNET_FAUCET_SECRET: faucetSecret,
  DEVNET_FAUCET_PORT: '8787',
  DEVNET_FAUCET_URL: 'http://127.0.0.1:8787/grant',

  ADMIN_KEYPAIR_PATH: resolve(homedir(), '.config/solana/id.json'),
  DEVNET_KEYPAIR_DIR: resolve(homedir(), '.config/accrue/devnet'),
  KEEPER_KEYPAIR_PATH: resolve(homedir(), '.config/accrue/devnet/keeper-keypair.json'),
  E2E_WALLET_KEYPAIR_PATH: resolve(
    homedir(),
    '.config/accrue/devnet/e2e-wallet-keypair.json',
  ),
  E2E_SCREENSHOT_DIR: resolve(homedir(), '.config/accrue/devnet/screenshots'),

  ACCRUE_PROGRAM_ID: '6KUwCyECUrvjppwAe92FxTqHLvw2LKGmfkV7j37r6gBb',
  POSITION_BUILDING_ENABLED: 'true',

  KEEPER_INTERVAL_SECONDS: '30',
  KEEPER_PRIORITY_FEE_LAMPORTS: '50000',
};

// Worked out from what is already on this machine rather than asked for.
function whatTheMachineKnows(): Record<string, string> {
  const known: Record<string, string> = {};
  const admin = theAdminAddress();
  if (admin !== null) {
    known['ACCRUE_GUARDIAN'] = admin;
    known['ACCRUE_UPGRADE_AUTHORITY'] = admin;
  }
  const hash = theBuildHash();
  if (hash !== null) {
    known['ACCRUE_BUILD_HASH'] = hash;
  }
  const treasury = fromTheDevnetRegistry('treasury');
  if (treasury !== null) {
    known['ACCRUE_TREASURY_USDC_ACCOUNT'] = treasury;
  }
  return known;
}

// The caps are the numbers in the shared example, which are the ceilings the code checks against.
function capsFromTheSharedExample(): Record<string, string> {
  const text = readFileSync(resolve(repositoryRoot, '../docs/env.example'), 'utf8');
  const caps: Record<string, string> = {};
  const wanted =
    /^(MAX_|MIN_|PRIORITY_FEE_LAMPORTS|RATE_LIMIT_|ACCRUE_CONFIG_|DEFILLAMA_|JUPITER_|KAMINO_|ACCRUE_BORROW_|NEXT_PUBLIC_)/u;
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0 || line.startsWith('#')) {
      continue;
    }
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (wanted.test(name) && value !== '') {
      caps[name] = value;
    }
  }
  return caps;
}

function valueFor(
  name: string,
  caps: Record<string, string>,
  known: Record<string, string>,
): string | null {
  return FILLED[name] ?? known[name] ?? caps[name] ?? null;
}

function namesEveryExampleWants(): string[] {
  const names: string[] = [];
  for (const file of FILES) {
    for (const line of readFileSync(
      resolve(repositoryRoot, `${file}.example`),
      'utf8',
    ).split('\n')) {
      const at = line.indexOf('=');
      if (at > 0 && !line.startsWith('#')) {
        const name = line.slice(0, at).trim();
        if (!names.includes(name)) {
          names.push(name);
        }
      }
    }
  }
  return names;
}

function namesAlreadyIn(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  const names: string[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0 && !line.startsWith('#')) {
      names.push(line.slice(0, at).trim());
    }
  }
  return names;
}

function valueAlreadyIn(path: string, name: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0 && !line.startsWith('#') && line.slice(0, at).trim() === name) {
      const value = line.slice(at + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

// The root file is the one place a person types anything, so it carries every name all three want.
function completeTheRootFile(
  caps: Record<string, string>,
  known: Record<string, string>,
): string[] {
  const path = resolve(repositoryRoot, '.env');
  const already = namesAlreadyIn(path);
  const added: string[] = [];
  const lines: string[] = [];

  for (const name of namesEveryExampleWants()) {
    if (already.includes(name)) {
      continue;
    }
    const value =
      WHERE_TO_GET_IT[name] === undefined ? valueFor(name, caps, known) : null;
    if (value === null || value === '') {
      lines.push(noteFor(name), `${name}=`);
    } else {
      lines.push(`${name}=${value}`);
    }
    added.push(name);
  }

  if (added.length === 0) {
    return [];
  }
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const opening = existing === '' ? theRootHeader() : existing.replace(/\n*$/u, '\n');
  writeFileSync(path, `${opening}\n# Added by pnpm env:init.\n${lines.join('\n')}\n`);
  return added;
}

function theRootHeader(): string {
  return readFileSync(resolve(repositoryRoot, '.env.example'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .slice(0, 3)
    .join('\n');
}

function fill(
  examplePath: string,
  caps: Record<string, string>,
  known: Record<string, string>,
): string {
  const lines = readFileSync(examplePath, 'utf8').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const at = line.indexOf('=');
    if (at <= 0 || line.startsWith('#')) {
      out.push(line);
      continue;
    }
    const name = line.slice(0, at).trim();
    const fromTheRoot = valueAlreadyIn(resolve(repositoryRoot, '.env'), name);
    const value =
      fromTheRoot ??
      (WHERE_TO_GET_IT[name] === undefined ? valueFor(name, caps, known) : null);
    if (value === null || value === '') {
      out.push(noteFor(name));
      out.push(`${name}=`);
      continue;
    }
    out.push(`${name}=${value}`);
  }
  return out.join('\n');
}

function main(): void {
  const caps = capsFromTheSharedExample();
  const known = whatTheMachineKnows();
  const addedToTheRoot = completeTheRootFile(caps, known);
  const written: string[] = [];
  const left: string[] = [];

  for (const file of FILES) {
    if (file === '.env') {
      continue;
    }
    const path = resolve(repositoryRoot, file);
    if (existsSync(path)) {
      left.push(file);
      continue;
    }
    writeFileSync(path, fill(`${path}.example`, caps, known));
    written.push(file);
  }

  if (addedToTheRoot.length > 0) {
    console.log(`added ${addedToTheRoot.length} names to .env, none of them touched`);
  } else {
    console.log('.env already names everything');
  }
  for (const file of written) {
    console.log(`wrote ${file}, taking any value .env already had`);
  }
  for (const file of left) {
    console.log(`left ${file} alone, it is already there`);
  }
  if (written.length > 0) {
    console.log('');
    console.log(
      'three values are yours to paste in, each with a line above it saying where:',
    );
    for (const name of Object.keys(WHERE_TO_GET_IT)) {
      console.log(`  ${name}`);
    }
    console.log('');
    console.log('then run pnpm env:check');
  }
}

main();
