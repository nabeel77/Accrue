import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { address, isAddress, type Address, type KeyPairSigner } from '@solana/kit';

import { shortenAddress } from '@accrue/core';

import {
  answer,
  callerHost,
  readBody,
  theSecretMatches,
  theSharedSecret,
} from './httpService.js';
import { connectToDevnet, reportStep, type Cluster } from './shared.js';
import { grantTestTokens, mintAuthoritySigner } from './faucet.js';

const DEFAULT_PORT = 8787;
const A_DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const GRANTS_PER_ADDRESS_PER_DAY = 1;
const GRANTS_PER_HOST_PER_DAY = 20;

interface Window {
  count: number;
  startedAt: number;
}

const perWallet = new Map<string, Window>();
const perHost = new Map<string, Window>();

function withinTheLimit(
  windows: Map<string, Window>,
  key: string,
  allowed: number,
): boolean {
  const now = Date.now();
  const current = windows.get(key);
  if (current === undefined || now - current.startedAt >= A_DAY_IN_MILLISECONDS) {
    windows.set(key, { count: 1, startedAt: now });
    return true;
  }
  if (current.count >= allowed) {
    return false;
  }
  current.count += 1;
  return true;
}

function refund(windows: Map<string, Window>, key: string): void {
  const current = windows.get(key);
  if (current !== undefined && current.count > 0) {
    current.count -= 1;
  }
}

async function handleGrant(
  cluster: Cluster,
  mintAuthority: KeyPairSigner,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const secretIsRequired = theSharedSecret() !== '';
  if (secretIsRequired && !theSecretMatches(request)) {
    answer(response, 401, { error: 'this faucet only answers its own server' });
    return;
  }

  const body = await readBody(request);
  const parsed = JSON.parse(body === '' ? '{}' : body) as { wallet?: unknown };
  if (typeof parsed.wallet !== 'string' || !isAddress(parsed.wallet)) {
    answer(response, 400, { error: 'send a wallet address' });
    return;
  }
  const wallet: Address = address(parsed.wallet);
  const host = callerHost(request);

  if (!withinTheLimit(perHost, host, GRANTS_PER_HOST_PER_DAY)) {
    answer(response, 429, { error: 'that host has had its grants for today' });
    return;
  }
  if (!withinTheLimit(perWallet, wallet, GRANTS_PER_ADDRESS_PER_DAY)) {
    refund(perHost, host);
    answer(response, 429, { error: 'that wallet has had its grant for today' });
    return;
  }

  try {
    const result = await grantTestTokens(cluster, mintAuthority, wallet);
    reportStep(
      `granted to ${shortenAddress(wallet)}  ${shortenAddress(result.signature)}`,
    );
    answer(response, 200, {
      wallet: result.wallet,
      signature: result.signature,
      grants: result.grants,
    });
  } catch (failure) {
    refund(perWallet, wallet);
    refund(perHost, host);
    reportStep(`grant to ${shortenAddress(wallet)} failed`);
    answer(response, 502, {
      error: failure instanceof Error ? failure.message : 'the grant did not land',
    });
  }
}

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const mintAuthority = await mintAuthoritySigner();
  const port = Number(process.env['DEVNET_FAUCET_PORT'] ?? DEFAULT_PORT);

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      answer(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/grant') {
      answer(response, 404, { error: 'post a wallet to /grant' });
      return;
    }
    void handleGrant(cluster, mintAuthority, request, response).catch(() => {
      answer(response, 500, { error: 'the faucet could not answer' });
    });
  });

  server.listen(port, () => {
    reportStep(
      `devnet faucet listening on ${port}, minting as ${shortenAddress(mintAuthority.address)}`,
    );
    reportStep(
      `  one grant per wallet a day, ${GRANTS_PER_HOST_PER_DAY} per host a day, shared secret ${
        theSharedSecret() === '' ? 'not set, so every caller is refused' : 'required'
      }`,
    );
  });
}

await main();
