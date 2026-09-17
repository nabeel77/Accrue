import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
  collateralAllowlist,
  collateralForMint,
  isAllowedCollateral,
} from './collateral.js';

describe('the stocks we take as collateral', () => {
  it('holds the ten reserves of the market we use', () => {
    const list = collateralAllowlist();
    expect(list).toHaveLength(10);
    expect(list.map((token) => token.symbol)).toEqual([
      'SPYx',
      'QQQx',
      'GOOGLx',
      'TSLAx',
      'NVDAx',
      'AAPLx',
      'METAx',
      'HOODx',
      'CRCLx',
      'MSTRx',
    ]);
  });

  it('names every mint once', () => {
    const mints = collateralAllowlist().map((token) => token.mint);
    expect(new Set(mints).size).toBe(mints.length);
  });

  it('matches on the mint and not on the symbol', () => {
    const nvdax = collateralForMint(
      address('Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'),
    );
    expect(nvdax?.symbol).toBe('NVDAx');

    // A token that borrows the name of one on the list is still not on the list.
    expect(
      isAllowedCollateral(address('So11111111111111111111111111111111111111112')),
    ).toBe(false);
  });

  it('refuses the USDC mint, which is the borrow side and never collateral', () => {
    expect(
      isAllowedCollateral(address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')),
    ).toBe(false);
  });
});
