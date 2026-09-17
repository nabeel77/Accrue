import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { address } from '@solana/kit';

import { findSandboxSwapAuthority } from '@accrue/solana';

import { namedSigner, readRegistry, reportStep } from './shared.js';
import { SANDBOX_TOKENS } from './tokens.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const rustPath = resolve(repositoryRoot, 'programs/accrue/src/clusters/devnet.rs');
const typescriptPath = resolve(repositoryRoot, 'packages/solana/src/clusters/devnet.ts');

interface SandboxAddresses {
  readonly lending: string;
  readonly farms: string;
  readonly swap: string;
  readonly priceFeed: string;
  readonly prices: string;
  readonly market: string;
  readonly mints: Record<string, string>;
  readonly reserves: Record<string, string>;
}

const RUST_LINE_LIMIT = 100;

/** Written the way rustfmt would write it, so the generated file passes the format check. */
function rustConstant(name: string, value: string): string {
  const oneLine = `pub const ${name}: Pubkey = address!("${value}");`;
  return oneLine.length <= RUST_LINE_LIMIT
    ? oneLine
    : `pub const ${name}: Pubkey =\n    address!("${value}");`;
}

function rustFile(addresses: SandboxAddresses): string {
  const constants = [
    rustConstant('KAMINO_LEND_PROGRAM_ID', addresses.lending),
    rustConstant('KAMINO_FARMS_PROGRAM_ID', addresses.farms),
    rustConstant('JUPITER_V6_PROGRAM_ID', addresses.swap),
    rustConstant('SCOPE_PROGRAM_ID', addresses.priceFeed),
    rustConstant('SCOPE_PRICE_ACCOUNT', addresses.prices),
  ];
  return `use anchor_lang::prelude::Pubkey;
use solana_address::address;

${constants.join('\n\n')}
`;
}

function typescriptEntries(entries: Record<string, string>): string {
  return SANDBOX_TOKENS.filter((token) => entries[token.symbol] !== undefined)
    .map((token) => `    ${token.symbol}: address('${entries[token.symbol] ?? ''}'),`)
    .join('\n');
}

function typescriptFile(addresses: SandboxAddresses): string {
  return `import { address } from '@solana/kit';

import type { ClusterAddresses } from './shape.js';

export const DEVNET: ClusterAddresses = {
  name: 'devnet',
  kaminoLendingProgram: address('${addresses.lending}'),
  kaminoFarmsProgram: address('${addresses.farms}'),
  swapProgram: address('${addresses.swap}'),
  scopeProgram: address('${addresses.priceFeed}'),
  scopePriceAccount: address('${addresses.prices}'),
  lendingMarket: address('${addresses.market}'),
  mints: {
${typescriptEntries(addresses.mints)}
  },
  reserves: {
${typescriptEntries(addresses.reserves)}
  },
};
`;
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === '') {
    throw new Error(
      `${what} is not in the devnet registry yet. Run the earlier scripts first.`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  const registry = readRegistry();
  const addresses: SandboxAddresses = {
    lending: (await namedSigner('klend')).address,
    farms: (await namedSigner('kfarms')).address,
    swap: (await namedSigner('honest-swap')).address,
    priceFeed: (await namedSigner('price-feed')).address,
    prices: required(registry.prices, 'the prices account'),
    market: required(registry.market, 'the lending market'),
    mints: registry.mints ?? {},
    reserves: registry.reserves ?? {},
  };

  writeFileSync(rustPath, rustFile(addresses));
  writeFileSync(typescriptPath, typescriptFile(addresses));

  reportStep(`wrote ${rustPath}`);
  reportStep(`wrote ${typescriptPath}`);
  reportStep('');
  reportStep('the sandbox, as the program and the client now see it');
  reportStep(`  lending market program  ${addresses.lending}`);
  reportStep(`  farms program           ${addresses.farms}`);
  reportStep(`  swap router             ${addresses.swap}`);
  reportStep(
    `  swap authority          ${await findSandboxSwapAuthority(address(addresses.swap))}`,
  );
  reportStep(`  price program           ${addresses.priceFeed}`);
  reportStep(`  prices account          ${addresses.prices}`);
  reportStep(`  lending market          ${addresses.market}`);
  for (const token of SANDBOX_TOKENS) {
    reportStep(
      `  ${token.symbol.padEnd(6)} mint ${addresses.mints[token.symbol] ?? '—'}  reserve ${
        addresses.reserves[token.symbol] ?? '—'
      }`,
    );
  }
}

await main();
