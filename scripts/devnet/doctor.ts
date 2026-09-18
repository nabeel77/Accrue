import { address, getProgramDerivedAddress } from '@solana/kit';

import { currentCluster } from '../../packages/solana/src/clusters/index.js';
import { readScopePrice, readReserve } from '../../packages/solana/src/kamino/adapter.js';
import { fetchConfig } from '../../packages/solana/src/program/accounts/config.js';
import { getPositionDecoder } from '../../packages/solana/src/program/accounts/position.js';
import { shortenAddress } from '../../packages/core/src/logging/shorten.js';

import { connectToDevnet, reportStep } from './shared.js';
import { SANDBOX_TOKENS } from './tokens.js';

const LAMPORTS_IN_A_SOL = 1_000_000_000n;
const A_SLOT_IN_MILLISECONDS = 400;
const MILLISECONDS_IN_A_SECOND = 1_000;
const CONFIG_SEED = 'config';
const ENOUGH_SOL_FOR_FEES = 5_000_000n;

function say(what: string, value: string, wrong = false): void {
  reportStep(`${wrong ? '  wrong ' : '  ok    '}${what.padEnd(34)}${value}`);
}

async function main(): Promise<void> {
  const { rpc } = connectToDevnet();
  const cluster = currentCluster();
  const fromTheEnvironment = process.env['ACCRUE_PROGRAM_ID'];
  if (fromTheEnvironment === undefined || fromTheEnvironment === '') {
    throw new Error('ACCRUE_PROGRAM_ID is not set, so there is nothing to look at.');
  }
  const programAddress = address(fromTheEnvironment);
  reportStep(
    `the sandbox as the chain has it, program ${shortenAddress(programAddress)}`,
  );

  const [configAddress] = await getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode(CONFIG_SEED)],
  });
  const config = await fetchConfig(rpc, configAddress, { commitment: 'confirmed' });
  say('opens paused', `${config.data.openPaused}`, config.data.openPaused);
  say('grows paused', `${config.data.growPaused}`);
  say('sunset', `${config.data.sunset}`, config.data.sunset);
  say('smallest position', `${config.data.minPositionUsd} dollars`);
  say('largest position', `${config.data.maxPositionUsd} dollars`);

  const maxAgeSlots = config.data.maxPriceAgeSlots;
  const windowSeconds =
    (Number(maxAgeSlots) * A_SLOT_IN_MILLISECONDS) / MILLISECONDS_IN_A_SECOND;
  say('a price may be', `${maxAgeSlots} slots old, about ${windowSeconds}s`);

  for (const token of SANDBOX_TOKENS) {
    const reserveAddress = cluster.reserves[token.symbol];
    if (reserveAddress === undefined) {
      continue;
    }
    const reserve = await readReserve(
      rpc,
      reserveAddress,
      BigInt(Math.floor(Date.now() / 1_000)),
    );
    const price = await readScopePrice(
      rpc,
      reserve.snapshot.scopePriceAccount,
      reserve.snapshot.scopeFeedIndex,
    );
    const ageSeconds =
      (Number(price.ageInSlots) * A_SLOT_IN_MILLISECONDS) / MILLISECONDS_IN_A_SECOND;
    say(
      `${token.symbol} price age`,
      `${price.ageInSlots} slots, about ${ageSeconds}s`,
      price.ageInSlots > maxAgeSlots,
    );
  }

  const found = await rpc
    .getProgramAccounts(programAddress, { encoding: 'base64', commitment: 'confirmed' })
    .send();
  const positions = found.flatMap((entry) => {
    try {
      const data = Uint8Array.from(Buffer.from(entry.account.data[0], 'base64'));
      return [{ address: entry.pubkey, position: getPositionDecoder().decode(data) }];
    } catch {
      return [];
    }
  });
  say('positions on the program', `${positions.length}`);

  for (const one of positions) {
    const owner = one.position.owner;
    const balance = await rpc.getBalance(owner, { commitment: 'confirmed' }).send();
    const held = BigInt(balance.value);
    say(
      `owner ${shortenAddress(owner)} has`,
      `${Number(held) / Number(LAMPORTS_IN_A_SOL)} SOL`,
      held < ENOUGH_SOL_FOR_FEES,
    );
    say(
      `position ${shortenAddress(one.address)}`,
      `state ${one.position.state}, target ${one.position.strategy.targetLtvBps / 100}%, guard ${one.position.strategy.protectLtvBps / 100}%`,
    );
    say(
      `  its guard has run`,
      `${one.position.protectCount} times, last ${one.position.lastProtectAt === 0n ? 'never' : new Date(Number(one.position.lastProtectAt) * 1000).toISOString()}`,
    );
    for (const [what, account] of [
      ['stock', one.position.collateralTokenAccount],
      ['usdc', one.position.usdcTokenAccount],
      ['yield token', one.position.destinationTokenAccount],
    ] as const) {
      const read = await rpc
        .getTokenAccountBalance(account, { commitment: 'confirmed' })
        .send()
        .catch(() => null);
      say(`  it holds ${what}`, read?.value.uiAmountString ?? 'no account');
    }
  }
}

await main();
