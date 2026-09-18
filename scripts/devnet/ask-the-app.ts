import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { createSignableMessage } from '@solana/kit';

import { encodeBase58 } from '../shared/base58.js';
import { loadSignerFromFile } from './shared.js';

const DEFAULT_APP_URL = 'http://127.0.0.1:3000';
const SHOWN_BODY_CHARACTERS = 600;
// A tenth of a stock token, which is over the smallest position at sandbox prices.
const OPENING_STOCK_RAW = '10000000';

// What the browser sends about the wallet that will sign. The default is a wallet that cannot
// read a version one transaction, which is every wallet installed today.
function buildHeaders(cookie: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    cookie,
    'x-wallet-takes-version-one':
      process.env['ACCRUE_WALLET_TAKES_VERSION_ONE'] === 'true' ? 'true' : 'false',
  };
}

function appUrl(): string {
  return process.env['ACCRUE_APP_URL'] ?? DEFAULT_APP_URL;
}

function expand(path: string): string {
  return path.startsWith('~') ? resolve(homedir(), path.slice(2)) : resolve(path);
}

async function theTestWallet(): Promise<{
  address: string;
  sign: (message: string) => Promise<string>;
}> {
  const path = process.env['E2E_WALLET_KEYPAIR_PATH'];
  if (path === undefined || path === '') {
    throw new Error('E2E_WALLET_KEYPAIR_PATH is not set.');
  }
  const signer = await loadSignerFromFile(expand(path));
  return {
    address: signer.address,
    sign: async (message: string) => {
      const [signed] = await signer.signMessages([
        createSignableMessage(new TextEncoder().encode(message)),
      ]);
      const signature = signed?.[signer.address];
      if (signature === undefined) {
        throw new Error('that wallet returned no signature');
      }
      return encodeBase58(new Uint8Array(signature));
    },
  };
}

// The app's own routes, asked as a signed in wallet would ask them, with no browser in the way.
async function main(): Promise<void> {
  const wallet = await theTestWallet();
  console.log(`asking ${appUrl()} as ${wallet.address}`);

  const asked = await fetch(
    `${appUrl()}/api/auth/nonce?wallet=${encodeURIComponent(wallet.address)}`,
  );
  const challenge = (await asked.json()) as {
    nonce: string;
    issuedAt: string;
    message: string;
  };
  const verified = await fetch(`${appUrl()}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wallet: wallet.address,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      signature: await wallet.sign(challenge.message),
    }),
  });
  const cookie = verified.headers.get('set-cookie')?.split(';')[0] ?? '';
  console.log(`signed in: ${verified.status}, cookie ${cookie === '' ? 'none' : 'held'}`);
  if (cookie === '') {
    console.log(await verified.text());
    return;
  }

  // What the deposit screen would do with this wallet: grow the position it already has, or
  // open one. A row of ours whose account is gone must read as no position at all.
  const defaults = await fetch(
    `${appUrl()}/api/defaults?destination=ONyc&stock=NVDAx&dollars=200`,
    { headers: { cookie } },
  );
  const read = (await defaults.json()) as {
    stocks?: { symbol: string; mint: string; openPositionId: string | null }[];
  };
  console.log(
    `deposit screen: ${(read.stocks ?? [])
      .map(
        (stock) =>
          `${stock.symbol} ${stock.openPositionId === null ? 'opens a new position' : `grows ${stock.openPositionId}`}`,
      )
      .join(', ')}`,
  );

  // Opening is the path a first deposit takes, and it is sized against a price that moves.
  const stocks = read.stocks ?? [];
  const toOpen = stocks.find((stock) => stock.openPositionId === null);
  if (toOpen !== undefined) {
    const opened = await fetch(`${appUrl()}/api/positions/build`, {
      method: 'POST',
      headers: buildHeaders(cookie),
      body: JSON.stringify({
        stockMint: toOpen.mint,
        destinationSymbol: 'ONyc',
        collateralAmountRaw: OPENING_STOCK_RAW,
      }),
    });
    const said = await opened.text();
    console.log(
      `open ${toOpen.symbol}: ${opened.status} ${said.slice(0, SHOWN_BODY_CHARACTERS)}`,
    );
  }

  const activity = await fetch(`${appUrl()}/api/activity`, { headers: { cookie } });
  const events = (await activity.json()) as { events?: { kind: string }[] };
  console.log(`activity: ${activity.status}, ${events.events?.length ?? 0} events`);

  const listed = await fetch(`${appUrl()}/api/positions`, { headers: { cookie } });
  const positions = (await listed.json()) as {
    positions?: { id: string; status: string; positionAddress: string | null }[];
  };
  const open = positions.positions?.find((one) => one.status === 'open');
  console.log(`positions: ${JSON.stringify(positions.positions ?? [])}`);
  if (open === undefined) {
    console.log('no open position of this wallet to act on');
    return;
  }

  for (const [what, path, body] of [
    ['repay', `/api/positions/${open.id}/repay/build`, { amountRaw: '1000000' }],
    [
      'add collateral',
      `/api/positions/${open.id}/add-collateral/build`,
      { amountRaw: '1000000' },
    ],
    ['unwind', `/api/positions/${open.id}/unwind/build`, {}],
  ] as const) {
    const answer = await fetch(`${appUrl()}${path}`, {
      method: 'POST',
      headers: buildHeaders(cookie),
      body: JSON.stringify(body),
    });
    const text = await answer.text();
    const looksLikeJson = text.trimStart().startsWith('{');
    console.log(
      `${what}: ${answer.status} ${looksLikeJson ? 'json' : 'not json'} ${text.slice(0, SHOWN_BODY_CHARACTERS)}`,
    );
  }
}

await main();
