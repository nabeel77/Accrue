import { address } from '@solana/kit';

import { getInitializeConfigInstructionAsync } from '../../packages/solana/src/program/instructions/initializeConfig.js';

import {
  configAddress,
  loadAdminSigner,
  requiredNumber,
  requiredVariable,
  sendOneInstruction,
  shortenAddress,
} from './shared.js';

async function main(): Promise<void> {
  const admin = await loadAdminSigner();
  const config = await configAddress();

  const instruction = await getInitializeConfigInstructionAsync({
    deployer: admin,
    treasury: address(requiredVariable('ACCRUE_TREASURY_USDC_ACCOUNT')),
    admin: admin.address,
    guardian: address(requiredVariable('ACCRUE_GUARDIAN')),
    limits: {
      keeperBountyBps: requiredNumber('ACCRUE_CONFIG_KEEPER_BOUNTY_BPS'),
      keeperBountyCapUsdc: BigInt(
        requiredNumber('ACCRUE_CONFIG_KEEPER_BOUNTY_CAP_USDC') * 1_000_000,
      ),
      performanceFeeBps: requiredNumber('ACCRUE_CONFIG_PERFORMANCE_FEE_BPS'),
      maxSlippageBps: requiredNumber('ACCRUE_CONFIG_MAX_SLIPPAGE_BPS'),
      maxPriceAgeSlots: BigInt(requiredNumber('ACCRUE_CONFIG_MAX_PRICE_AGE_SLOTS')),
      minProtectIntervalSeconds: BigInt(
        requiredNumber('ACCRUE_CONFIG_MIN_PROTECT_INTERVAL_SECONDS'),
      ),
      minGrowIntervalSeconds: BigInt(
        requiredNumber('ACCRUE_CONFIG_MIN_GROW_INTERVAL_SECONDS'),
      ),
      maxShareOfAvailableBps: requiredNumber('ACCRUE_CONFIG_MAX_SHARE_OF_AVAILABLE_BPS'),
      minPositionUsd: BigInt(requiredNumber('ACCRUE_CONFIG_MIN_POSITION_USD')),
      maxPositionUsd: BigInt(requiredNumber('ACCRUE_CONFIG_MAX_POSITION_USD')),
    },
  });

  const signature = await sendOneInstruction(instruction, admin);
  console.log(`config ${shortenAddress(config)} written in ${signature}`);
}

await main();
