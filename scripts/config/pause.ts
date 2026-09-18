import { parseArgs } from 'node:util';

import { none, some, type Option } from '@solana/kit';

import { getSetPausedInstructionAsync } from '../../packages/solana/src/program/instructions/setPaused.js';

import { configAddress, loadAdminSigner, sendOneInstruction } from './shared.js';

const { values } = parseArgs({
  options: {
    opens: { type: 'string' },
    grows: { type: 'string' },
  },
});

function wanted(name: 'opens' | 'grows'): Option<boolean> {
  const value = values[name];
  if (value === undefined) {
    return none();
  }
  if (value !== 'true' && value !== 'false') {
    throw new Error(`--${name} takes true or false.`);
  }
  return some(value === 'true');
}

async function main(): Promise<void> {
  const openPaused = wanted('opens');
  const growPaused = wanted('grows');
  if (openPaused.__option === 'None' && growPaused.__option === 'None') {
    throw new Error('Say --opens true|false, --grows true|false, or both.');
  }

  const authority = await loadAdminSigner();
  const instruction = await getSetPausedInstructionAsync({
    authority,
    config: await configAddress(),
    openPaused,
    growPaused,
  });
  const signature = await sendOneInstruction(instruction, authority);
  console.log(`opens paused: ${describe(openPaused)}`);
  console.log(`grows paused: ${describe(growPaused)}`);
  console.log(signature);
}

function describe(value: Option<boolean>): string {
  return value.__option === 'None' ? 'unchanged' : `${value.value}`;
}

await main();
