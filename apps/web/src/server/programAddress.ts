import 'server-only';

import { address, type Address } from '@solana/kit';

import { ACCRUE_PROGRAM_ADDRESS } from '@accrue/solana/program';

import { optional } from './env.js';

export function accrueProgramAddress(): Address {
  const named = optional('ACCRUE_PROGRAM_ID');
  return named === undefined ? ACCRUE_PROGRAM_ADDRESS : address(named);
}
