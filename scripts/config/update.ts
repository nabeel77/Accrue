import { parseArgs } from 'node:util';

import {
  address,
  createSolanaRpc,
  none,
  some,
  type Address,
  type Option,
} from '@solana/kit';

import { fetchConfig } from '../../packages/solana/src/program/accounts/config.js';
import { getUpdateConfigInstructionAsync } from '../../packages/solana/src/program/instructions/updateConfig.js';
import type {
  CollateralEntryArgs,
  ConfigLimitsArgs,
  DestinationEntryArgs,
} from '../../packages/solana/src/program/types/index.js';

import {
  configAddress,
  loadAdminSigner,
  requiredVariable,
  sendOneInstruction,
  shortenAddress,
} from './shared.js';

const LIMIT_FLAGS = {
  'keeper-bounty-bps': 'keeperBountyBps',
  'keeper-bounty-cap-usdc': 'keeperBountyCapUsdc',
  'performance-fee-bps': 'performanceFeeBps',
  'max-slippage-bps': 'maxSlippageBps',
  'max-price-age-slots': 'maxPriceAgeSlots',
  'min-protect-interval-seconds': 'minProtectIntervalSeconds',
  'min-grow-interval-seconds': 'minGrowIntervalSeconds',
  'max-share-of-available-bps': 'maxShareOfAvailableBps',
  'min-position-usd': 'minPositionUsd',
  'max-position-usd': 'maxPositionUsd',
} as const satisfies Record<string, keyof ConfigLimitsArgs>;

const BIGINT_LIMITS = new Set<keyof ConfigLimitsArgs>([
  'keeperBountyCapUsdc',
  'maxPriceAgeSlots',
  'minProtectIntervalSeconds',
  'minGrowIntervalSeconds',
  'minPositionUsd',
  'maxPositionUsd',
]);

const { values } = parseArgs({
  options: {
    ...Object.fromEntries(
      Object.keys(LIMIT_FLAGS).map((flag) => [flag, { type: 'string' as const }]),
    ),
    treasury: { type: 'string' },
    guardian: { type: 'string' },
    admin: { type: 'string' },
    'collateral-mint': { type: 'string' },
    'collateral-reserve': { type: 'string' },
    'collateral-token-program': { type: 'string' },
    'collateral-scope-account': { type: 'string' },
    'collateral-scope-feed': { type: 'string' },
    'collateral-enabled': { type: 'string' },
    'destination-mint': { type: 'string' },
    'destination-token-program': { type: 'string' },
    'destination-scope-account': { type: 'string' },
    'destination-scope-feed': { type: 'string' },
    'destination-enabled': { type: 'string' },
  },
});

function flag(name: string): string | undefined {
  return (values as Record<string, string | undefined>)[name];
}

function requiredFlag(name: string): string {
  const value = flag(name);
  if (value === undefined) {
    throw new Error(`--${name} is required alongside the other entry flags.`);
  }
  return value;
}

function asAddress(name: string): Address {
  return address(requiredFlag(name));
}

function isEnabled(name: string): boolean {
  return flag(name) !== 'false';
}

async function limitsIfAnyFlagIsSet(): Promise<Option<ConfigLimitsArgs>> {
  const changed = Object.keys(LIMIT_FLAGS).filter((name) => flag(name) !== undefined);
  if (changed.length === 0) {
    return none();
  }

  const rpc = createSolanaRpc(requiredVariable('HELIUS_RPC_URL'));
  const current = await fetchConfig(rpc, await configAddress());

  const limits: ConfigLimitsArgs = {
    keeperBountyBps: current.data.keeperBountyBps,
    keeperBountyCapUsdc: current.data.keeperBountyCapUsdc,
    performanceFeeBps: current.data.performanceFeeBps,
    maxSlippageBps: current.data.maxSlippageBps,
    maxPriceAgeSlots: current.data.maxPriceAgeSlots,
    minProtectIntervalSeconds: current.data.minProtectIntervalSeconds,
    minGrowIntervalSeconds: current.data.minGrowIntervalSeconds,
    maxShareOfAvailableBps: current.data.maxShareOfAvailableBps,
    minPositionUsd: current.data.minPositionUsd,
    maxPositionUsd: current.data.maxPositionUsd,
  };

  for (const [name, field] of Object.entries(LIMIT_FLAGS)) {
    const value = flag(name);
    if (value === undefined) {
      continue;
    }
    Object.assign(limits, {
      [field]: BIGINT_LIMITS.has(field) ? BigInt(value) : Number(value),
    });
  }

  return some(limits);
}

function collateralEntry(): Option<CollateralEntryArgs> {
  if (flag('collateral-mint') === undefined) {
    return none();
  }
  return some({
    mint: asAddress('collateral-mint'),
    reserve: asAddress('collateral-reserve'),
    tokenProgram: asAddress('collateral-token-program'),
    scopePriceAccount: asAddress('collateral-scope-account'),
    scopeFeedIndex: Number(requiredFlag('collateral-scope-feed')),
    enabled: isEnabled('collateral-enabled'),
  });
}

function destinationEntry(): Option<DestinationEntryArgs> {
  if (flag('destination-mint') === undefined) {
    return none();
  }
  return some({
    mint: asAddress('destination-mint'),
    tokenProgram: asAddress('destination-token-program'),
    scopePriceAccount: asAddress('destination-scope-account'),
    scopeFeedIndex: Number(requiredFlag('destination-scope-feed')),
    enabled: isEnabled('destination-enabled'),
  });
}

function addressOption(name: string): Option<Address> {
  const value = flag(name);
  return value === undefined ? none() : some(address(value));
}

async function main(): Promise<void> {
  const admin = await loadAdminSigner();
  const update = {
    limits: await limitsIfAnyFlagIsSet(),
    treasury: addressOption('treasury'),
    guardian: addressOption('guardian'),
    adminArg: addressOption('admin'),
    collateral: collateralEntry(),
    destination: destinationEntry(),
  };

  const nothingToDo = Object.values(update).every((field) => field.__option === 'None');
  if (nothingToDo) {
    throw new Error('No flags given, so there is nothing to change.');
  }

  const instruction = await getUpdateConfigInstructionAsync({
    admin,
    ...update,
  });
  const signature = await sendOneInstruction(instruction, admin);
  console.log(`config ${shortenAddress(await configAddress())} changed in ${signature}`);
}

await main();
