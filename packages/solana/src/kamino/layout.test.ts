import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
  decodeLendingMarket,
  decodeObligation,
  decodeReserve,
  decodeScopePrice,
} from './layout.js';

const fixtures = resolve(import.meta.dirname, '../../../../tests/fixtures/accounts');

// The lending market's own enum. Hidden is a display flag, not a retirement: a hidden reserve
// still lends.
const RESERVE_STATUS_OFFSET = 4_856;
const STATUS_ACTIVE = 0;
const STATUS_OBSOLETE = 1;
const STATUS_HIDDEN = 2;

function fixtureData(label: string): Uint8Array {
  const captured = JSON.parse(
    readFileSync(resolve(fixtures, `${label}.json`), 'utf8'),
  ) as {
    data_base64: string;
  };
  return new Uint8Array(Buffer.from(captured.data_base64, 'base64'));
}

const XSTOCKS_MARKET = address('5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const NVDAX_MINT = address('Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh');
const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

describe('reading the lending market the way the keeper does', () => {
  it('reads the stock reserve the product is built on', () => {
    const reserve = decodeReserve(fixtureData('reserve_nvdax'));

    expect(reserve.lendingMarket).toBe(XSTOCKS_MARKET);
    expect(reserve.liquidityMint).toBe(NVDAX_MINT);
    expect(reserve.liquidityMintDecimals).toBe(8);
    expect(reserve.maxLoanToValueBps).toBe(5_500);
    expect(reserve.liquidationThresholdBps).toBe(6_500);
    expect(reserve.isActive).toBe(true);
    expect(reserve.isObsolete).toBe(false);
    expect(reserve.autodeleverageEnabled).toBe(false);
    expect(reserve.collateralFarm).toBeNull();
    expect(reserve.debtFarm).toBeNull();
    expect(reserve.scopeFeedIndex).toBe(332);
  });

  it('reads the vaults and the token program the stock reserve moves tokens through', () => {
    const reserve = decodeReserve(fixtureData('reserve_nvdax'));

    expect(reserve.liquidityTokenProgram).toBe(TOKEN_2022_PROGRAM);
    expect(reserve.liquiditySupplyVault).toBe(
      address('29eAnrDKTwiWkBnx4HmVtdCS4BktzuVwQrffRfSbLhfq'),
    );
    expect(reserve.liquidityFeeVault).toBe(
      address('61pcESuYFX7Lr1okCWpbeZjNeJxeSU9GGBXBUTKRsT7N'),
    );
    expect(reserve.collateralMint).toBe(
      address('Bx2gmSXWq3SCk5BDuK43LAKZAdmXmAQD5NJ7DySBrrLq'),
    );
    expect(reserve.collateralSupplyVault).toBe(
      address('FtajZ9gSs6tTABZQFRnwSHhrAGvG4KsURSL1SKE3bnEX'),
    );
    expect(reserve.collateralMintTotalSupply).toBeGreaterThan(0n);
    expect(reserve.liquidityMarketPriceScaled).toBeGreaterThan(0n);
  });

  it('reads the borrow reserve and the farm every borrow has to carry', () => {
    const reserve = decodeReserve(fixtureData('reserve_usdc'));

    expect(reserve.liquidityMint).toBe(USDC_MINT);
    expect(reserve.liquidityMintDecimals).toBe(6);
    expect(reserve.liquidityTokenProgram).toBe(TOKEN_PROGRAM);
    expect(reserve.liquiditySupplyVault).toBe(
      address('72Gz8BM8vDr5zdeHmFB5A2ptNZYfVgDuw5LDkNwGDdTA'),
    );
    expect(reserve.liquidityFeeVault).toBe(
      address('DPHXY8LbH4cPPAgBDNnrU7B2XwmhWcBZ9wTBi3uZpfh4'),
    );
    expect(reserve.collateralFarm).toBeNull();
    expect(reserve.debtFarm).toBe(
      address('82eHAjSXZEyA3UpBxTjVYXF4QJmAEtLR6kvWXQca7mqd'),
    );
    expect(reserve.scopeFeedIndex).toBe(13);
    expect(reserve.liquidityAvailableAmount).toBeGreaterThan(0n);
  });

  it('reads the status the market left on METAx', () => {
    expect(decodeReserve(fixtureData('reserve_metax')).status).toBe(STATUS_HIDDEN);
  });

  it('calls only an obsolete reserve a reason to leave', () => {
    const wanted = [
      { status: STATUS_ACTIVE, isObsolete: false },
      { status: STATUS_OBSOLETE, isObsolete: true },
      { status: STATUS_HIDDEN, isObsolete: false },
    ];
    for (const { status, isObsolete } of wanted) {
      const data = Uint8Array.from(fixtureData('reserve_nvdax'));
      data[RESERVE_STATUS_OFFSET] = status;
      expect(decodeReserve(data).status).toBe(status);
      expect(decodeReserve(data).isObsolete).toBe(isObsolete);
    }
  });

  it('reads the deleveraging fields the leave rule weighs', () => {
    const market = decodeLendingMarket(fixtureData('xstocks_market'));
    expect(market.autodeleverageEnabled).toBe(false);

    const obligation = decodeObligation(fixtureData('obligation_with_debt'));
    expect(obligation.autodeleverageMarginCallStartedTimestamp).toBe(0n);

    for (const label of ['reserve_usdc', 'reserve_nvdax', 'reserve_spyx']) {
      expect(decodeReserve(fixtureData(label)).deleveragingMarginCallPeriodSeconds).toBe(
        604_800n,
      );
    }
  });

  it('reads the borrow factor the market weights each reserve by', () => {
    expect(decodeReserve(fixtureData('reserve_usdc')).borrowFactorPct).toBe(100);
    expect(decodeReserve(fixtureData('reserve_nvdax')).borrowFactorPct).toBe(225);
  });

  it('reads the limit timestamps a deleveraging would set', () => {
    for (const label of ['reserve_usdc', 'reserve_nvdax', 'reserve_spyx']) {
      const reserve = decodeReserve(fixtureData(label));
      expect(reserve.depositLimitCrossedTimestamp).toBe(0n);
      expect(reserve.borrowLimitCrossedTimestamp).toBe(0n);
      expect(reserve.isObsolete).toBe(false);
      expect(reserve.autodeleverageEnabled).toBe(false);
    }

    expect(decodeReserve(fixtureData('reserve_metax')).depositLimitCrossedTimestamp).toBe(
      1_753_830_774n,
    );
  });

  it('reads a real obligation and agrees with its own totals', () => {
    const obligation = decodeObligation(fixtureData('obligation_with_debt'));

    expect(obligation.hasDebt).toBe(true);
    expect(obligation.depositedValueScaled).toBeGreaterThan(0n);
    expect(obligation.borrowedValueScaled).toBeGreaterThan(0n);
    expect(obligation.loanToValueBps).toBe(
      Number(
        (obligation.adjustedDebtValueScaled * 10_000n) / obligation.depositedValueScaled,
      ),
    );
    expect(obligation.adjustedDebtValueScaled).toBeGreaterThanOrEqual(
      obligation.borrowedValueScaled,
    );
    expect(obligation.loanToValueBps).toBeGreaterThan(0);
    expect(obligation.loanToValueBps).toBeLessThan(10_000);
    expect(obligation.depositReserves.length).toBeGreaterThan(0);
    expect(obligation.borrowReserves.length).toBeGreaterThan(0);
    expect(obligation.depositedAmountFor(obligation.depositReserves[0]!)).toBeGreaterThan(
      0n,
    );
    expect(
      obligation.borrowedAmountScaledFor(obligation.borrowReserves[0]!),
    ).toBeGreaterThan(0n);
  });

  it('reads the oracle prices the guard sells against', () => {
    const prices = fixtureData('oracle_scope_prices');
    const nvdax = decodeScopePrice(prices, 332);
    const usdc = decodeScopePrice(prices, 13);

    const asNumber = (price: { value: bigint; exponent: bigint }) =>
      Number(price.value) / 10 ** Number(price.exponent);

    expect(asNumber(nvdax)).toBeGreaterThan(100);
    expect(asNumber(nvdax)).toBeLessThan(250);
    expect(asNumber(usdc)).toBeGreaterThan(0.98);
    expect(asNumber(usdc)).toBeLessThan(1.05);
    expect(nvdax.lastUpdatedSlot).toBeGreaterThan(0n);
  });

  it('refuses an account that is not the length it should be', () => {
    expect(() => decodeReserve(new Uint8Array(10))).toThrow();
    expect(() => decodeObligation(new Uint8Array(10))).toThrow();
    expect(() => decodeScopePrice(new Uint8Array(10), 0)).toThrow();
  });
});
