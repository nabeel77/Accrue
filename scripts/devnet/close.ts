import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const { address } = await import('@solana/kit');
const { buildUnwindAndClose } =
  await import('../../apps/web/src/server/positions/buildOwnerAction.js');
const { stepTimer } = await import('../../apps/web/src/server/positions/steps.js');
const { currentCluster } = await import('@accrue/solana');

function walletAddress(): string {
  const path = process.env['E2E_WALLET_KEYPAIR_PATH'];
  if (path === undefined || path === '') {
    throw new Error('E2E_WALLET_KEYPAIR_PATH is not set. See .env.example.');
  }
  const expanded = path.startsWith('~') ? resolve(homedir(), path.slice(2)) : path;
  const bytes = JSON.parse(readFileSync(expanded, 'utf8')) as number[];
  return process.env['E2E_WALLET_ADDRESS'] ?? bytesToAddress(bytes);
}

function bytesToAddress(bytes: readonly number[]): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes.slice(32)) {
    value = (value << 8n) | BigInt(byte);
  }
  let out = '';
  while (value > 0n) {
    out = `${alphabet[Number(value % 58n)] ?? ''}${out}`;
    value /= 58n;
  }
  return out;
}

async function main(): Promise<void> {
  const cluster = currentCluster();
  const owner = walletAddress();
  const collateral = cluster.mints['NVDAx'];
  const destination = cluster.mints['ONyc'];
  if (collateral === undefined || destination === undefined) {
    throw new Error('this cluster has no NVDAx or ONyc');
  }

  console.error(`closing for ${owner} on ${cluster.name}`);
  const steps = stepTimer();
  const startedAt = Date.now();
  try {
    const outcome = await buildUnwindAndClose(
      {
        owner: address(owner),
        collateralMint: collateral,
        destinationMint: destination,
      },
      steps,
    );
    if ('refused' in outcome) {
      console.error(`refused: ${outcome.refused.message}`);
    } else {
      for (const one of outcome.built) {
        console.error(
          `  a transaction of ${one.bytes} bytes at version ${one.version} naming ${one.uniqueAddresses} addresses`,
        );
      }
    }
  } catch (failure) {
    console.error(`failed: ${failure instanceof Error ? failure.message : 'unknown'}`);
  }

  for (const step of steps.taken()) {
    console.error(`  ${step.name.padEnd(28)} ${step.milliseconds} ms`);
  }
  console.error(`  ${'everything'.padEnd(28)} ${Date.now() - startedAt} ms`);
}

await main();
