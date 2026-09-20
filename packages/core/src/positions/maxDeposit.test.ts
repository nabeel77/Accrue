import { describe, expect, it } from 'vitest';

import { SCALED_FRACTION_ONE } from '../money.js';
import {
  aPriceHasArrivedFor,
  theMostThatCanBeDeposited,
  walletValueInDollars,
  wholeBalanceOfAStock,
  whatTheMaxButtonFills,
  type AStockInTheWallet,
} from './maxDeposit.js';

const EIGHT_DECIMALS = 8;

function atThisPrice(dollars: number): string {
  return (
    (BigInt(Math.round(dollars * 1_000_000)) * SCALED_FRACTION_ONE) /
    1_000_000n
  ).toString();
}

function stockInTheWallet(wholeTokens: number, dollars: number): AStockInTheWallet {
  return {
    balanceRaw: BigInt(Math.round(wholeTokens * 10 ** EIGHT_DECIMALS)).toString(),
    decimals: EIGHT_DECIMALS,
    oraclePriceScaled: atThisPrice(dollars),
  };
}

describe('what MAX fills on the deposit screen', () => {
  it('values SPYx at its own price with its own eight decimals', () => {
    const spyx = stockInTheWallet(23.998, 563.4333);

    expect(wholeBalanceOfAStock(spyx)).toBeCloseTo(23.998, 6);
    expect(walletValueInDollars(spyx)).toBeCloseTo(13_521.27, 1);
    expect(whatTheMaxButtonFills(spyx, null)).toBe('13521.27');
  });

  it('values NVDAx at its own price with the same eight decimals', () => {
    const nvdax = stockInTheWallet(23.998, 152.8792);

    expect(wholeBalanceOfAStock(nvdax)).toBeCloseTo(23.998, 6);
    expect(walletValueInDollars(nvdax)).toBeCloseTo(3_668.79, 1);
    expect(whatTheMaxButtonFills(nvdax, null)).toBe('3668.79');
  });

  it('never fills more than the largest position the caps allow', () => {
    const spyx = stockInTheWallet(23.998, 563.4333);

    expect(theMostThatCanBeDeposited(spyx, 1_000)).toBe(1_000);
    expect(whatTheMaxButtonFills(spyx, 1_000)).toBe('1000.00');
  });

  it('rounds down to the cent, so MAX never offers more than is held', () => {
    const awkward = stockInTheWallet(1, 10.999_999);

    expect(whatTheMaxButtonFills(awkward, null)).toBe('10.99');
  });

  it('reads a reserve that has never been refreshed as having no price yet', () => {
    const neverRefreshed: AStockInTheWallet = {
      balanceRaw: '2399800000',
      decimals: EIGHT_DECIMALS,
      oraclePriceScaled: '0',
    };

    expect(aPriceHasArrivedFor(neverRefreshed)).toBe(false);
    expect(whatTheMaxButtonFills(neverRefreshed, null)).toBe('0.00');
    expect(aPriceHasArrivedFor(stockInTheWallet(23.998, 563.4333))).toBe(true);
    expect(aPriceHasArrivedFor(null)).toBe(false);
  });

  it('holds nothing when the wallet holds nothing', () => {
    const empty: AStockInTheWallet = {
      balanceRaw: null,
      decimals: EIGHT_DECIMALS,
      oraclePriceScaled: atThisPrice(563.4333),
    };

    expect(wholeBalanceOfAStock(empty)).toBe(0);
    expect(whatTheMaxButtonFills(empty, null)).toBe('0.00');
  });
});
