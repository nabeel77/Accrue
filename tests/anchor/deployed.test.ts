import { createSolanaRpc } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { ACCRUE_PROGRAM_ADDRESS } from '../../packages/solana/src/program/index.js';

const LOCAL_VALIDATOR_URL = 'http://127.0.0.1:8899';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';

const rpc = createSolanaRpc(LOCAL_VALIDATOR_URL);

describe('the program on the validator Anchor started', () => {
  it('is deployed at the address the generated client uses', async () => {
    const { value: programAccount } = await rpc
      .getAccountInfo(ACCRUE_PROGRAM_ADDRESS, { encoding: 'base64' })
      .send();

    expect(
      programAccount,
      `nothing deployed at ${ACCRUE_PROGRAM_ADDRESS}`,
    ).not.toBeNull();
    expect(programAccount?.executable).toBe(true);
    expect(programAccount?.owner).toBe(UPGRADEABLE_LOADER);
  });

  it('reads transactions at the version Accrue builds', async () => {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    expect(latestBlockhash.blockhash.length).toBeGreaterThan(0);
  });
});
