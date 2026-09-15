import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { address, getBase58Decoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
  KAMINO_FARMS_PROGRAM_ADDRESS,
  SCOPE_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from '../programIds.js';
import {
  findAssociatedTokenAccount,
  findKaminoObligation,
  findKaminoUserMetadata,
  findLendingMarketAuthority,
  findObligationFarmUserState,
  findTheThreeTokenAccounts,
  reserveAccounts,
} from './addresses.js';
import { decodeReserve } from './layout.js';

const fixtures = resolve(import.meta.dirname, '../../../../tests/fixtures/accounts');

interface CapturedAccount {
  readonly address: string;
  readonly owner: string;
  readonly data_base64: string;
}

function fixture(label: string): CapturedAccount {
  return JSON.parse(
    readFileSync(resolve(fixtures, `${label}.json`), 'utf8'),
  ) as CapturedAccount;
}

function fixtureAddress(label: string): Address {
  return address(fixture(label).address);
}

function fixtureData(label: string): Uint8Array {
  return new Uint8Array(Buffer.from(fixture(label).data_base64, 'base64'));
}

function addressAt(data: Uint8Array, offset: number): Address {
  return getBase58Decoder().decode(data.subarray(offset, offset + 32)) as Address;
}

/** An address lookup table is a fixed header and then one address every 32 bytes. */
const LOOKUP_TABLE_HEADER_LENGTH = 56;

function addressesInTheMarketsLookupTable(): Address[] {
  const data = fixtureData('xstocks_lookup_table');
  const entries: Address[] = [];
  for (
    let offset = LOOKUP_TABLE_HEADER_LENGTH;
    offset + 32 <= data.length;
    offset += 32
  ) {
    entries.push(addressAt(data, offset));
  }
  return entries;
}

/** The obligation fixture names the market it belongs to and the wallet that owns it. */
const OBLIGATION_LENDING_MARKET = 32;
const OBLIGATION_OWNER = 64;

const XSTOCKS_MARKET = fixtureAddress('xstocks_market');
const NVDAX_MINT = fixtureAddress('mint_nvdax');
const USDC_MINT = fixtureAddress('mint_usdc');
const ONYC_MINT = fixtureAddress('mint_onyc');
const USDC_DEBT_FARM = fixtureAddress('farm_usdc_debt');
const SCOPE_PRICES = fixtureAddress('oracle_scope_prices');

const nvdaxReserve = decodeReserve(fixtureData('reserve_nvdax'));
const usdcReserve = decodeReserve(fixtureData('reserve_usdc'));

/** A stand in for a position address. Nothing here needs it to be an account that exists. */
const A_POSITION = address('Bt5jTGYs2oGWTrz5VLVzbfMs5UWtTNLKWTSPrxwzTLcB');
const A_WALLET = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

describe('the addresses the guard derives from what it already holds', () => {
  it('derives the authority the market publishes in its own lookup table', async () => {
    const authority = await findLendingMarketAuthority(XSTOCKS_MARKET);

    expect(authority).toBe(address('2Z7zhqp1eddmHNmEqexftST6DFPWmoL4QqfgiG5uJMJx'));
    expect(addressesInTheMarketsLookupTable()).toContain(authority);
  });

  it('derives a real obligation from the market and owner it records', async () => {
    const obligation = fixtureData('obligation_with_debt');

    const derived = await findKaminoObligation({
      owner: addressAt(obligation, OBLIGATION_OWNER),
      lendingMarket: addressAt(obligation, OBLIGATION_LENDING_MARKET),
    });

    expect(addressAt(obligation, OBLIGATION_LENDING_MARKET)).toBe(XSTOCKS_MARKET);
    expect(derived).toBe(fixtureAddress('obligation_with_debt'));
  });

  // No fixture holds a metadata record, so the seed itself is proved by the lending market
  // accepting it when a position is opened in the keeper round. This pins the answer so a
  // changed seed shows up here too.
  it('derives the metadata record for the wallet that obligation belongs to', async () => {
    const owner = addressAt(fixtureData('obligation_with_debt'), OBLIGATION_OWNER);

    expect(await findKaminoUserMetadata(owner)).toBe(
      address('53xsJevKKZif2sxL5rtFmoH5H38xvDva8QFytGAKeu73'),
    );
    expect(await findKaminoUserMetadata(owner)).not.toBe(
      fixtureAddress('obligation_with_debt'),
    );
  });

  it('derives the stake in the farm the borrow reserve names', async () => {
    expect(usdcReserve.debtFarm).toBe(USDC_DEBT_FARM);
    expect(fixture('farm_usdc_debt').owner).toBe(KAMINO_FARMS_PROGRAM_ADDRESS);

    const obligation = fixtureAddress('obligation_with_debt');
    const stake = await findObligationFarmUserState({
      reserveFarmState: USDC_DEBT_FARM,
      obligation,
    });
    const someoneElses = await findObligationFarmUserState({
      reserveFarmState: USDC_DEBT_FARM,
      obligation: A_POSITION,
    });

    expect(stake).not.toBe(someoneElses);
    expect(stake).not.toBe(obligation);
  });

  it('reads the vaults a reserve names rather than deriving them', () => {
    const borrow = reserveAccounts(usdcReserve);
    const published = addressesInTheMarketsLookupTable();

    expect(usdcReserve.liquidityMint).toBe(USDC_MINT);
    expect(borrow.liquidityTokenProgram).toBe(TOKEN_PROGRAM_ADDRESS);
    expect(borrow.liquiditySupply).toBe(
      address('72Gz8BM8vDr5zdeHmFB5A2ptNZYfVgDuw5LDkNwGDdTA'),
    );
    expect(borrow.liquidityFeeReceiver).toBe(
      address('DPHXY8LbH4cPPAgBDNnrU7B2XwmhWcBZ9wTBi3uZpfh4'),
    );
    expect(borrow.collateralMint).toBe(
      address('69nwLK2t639e2c2ZWmZAbs2HWKZwG4pXVPzBTiEtNmwf'),
    );
    expect(borrow.collateralSupply).toBe(
      address('DWSGoajpT2X7TmnW2uCtfUoKEy8CPoBYnu94ntrpjk44'),
    );
    expect(published).toContain(borrow.liquiditySupply);
    expect(published).toContain(borrow.collateralSupply);
  });

  it('reads the stock reserve as a Token 2022 mint with its own vaults', () => {
    const collateral = reserveAccounts(nvdaxReserve);

    expect(nvdaxReserve.liquidityMint).toBe(NVDAX_MINT);
    expect(fixture('mint_nvdax').owner).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    expect(collateral.liquidityTokenProgram).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    expect(collateral.liquiditySupply).toBe(
      address('29eAnrDKTwiWkBnx4HmVtdCS4BktzuVwQrffRfSbLhfq'),
    );
    expect(collateral.collateralMint).toBe(
      address('Bx2gmSXWq3SCk5BDuK43LAKZAdmXmAQD5NJ7DySBrrLq'),
    );
    expect(collateral.collateralSupply).toBe(
      address('FtajZ9gSs6tTABZQFRnwSHhrAGvG4KsURSL1SKE3bnEX'),
    );
    expect(addressesInTheMarketsLookupTable()).toContain(collateral.liquiditySupply);
  });

  it('takes the price account both reserves name and the oracle owns', () => {
    expect(nvdaxReserve.scopePriceAccount).toBe(SCOPE_PRICES);
    expect(usdcReserve.scopePriceAccount).toBe(SCOPE_PRICES);
    expect(fixture('oracle_scope_prices').owner).toBe(SCOPE_PROGRAM_ADDRESS);
  });
});

describe('the three token accounts a strategy needs on each side', () => {
  const mints = {
    collateral: { mint: NVDAX_MINT, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
    usdc: { mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS },
    destination: { mint: ONYC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS },
  } as const;

  it('derives one account per mint and token program', async () => {
    const held = await findTheThreeTokenAccounts(A_POSITION, mints);

    expect(new Set([held.collateral, held.usdc, held.destination]).size).toBe(3);
    expect(held.collateral).toBe(
      await findAssociatedTokenAccount({ owner: A_POSITION, ...mints.collateral }),
    );
  });

  it('gives the owner and the position different accounts for the same mint', async () => {
    const held = await findTheThreeTokenAccounts(A_POSITION, mints);
    const theirs = await findTheThreeTokenAccounts(A_WALLET, mints);

    expect(theirs.collateral).not.toBe(held.collateral);
    expect(theirs.usdc).not.toBe(held.usdc);
    expect(theirs.destination).not.toBe(held.destination);
  });

  it('follows the token program, so one mint under two programs is two accounts', async () => {
    const underClassic = await findAssociatedTokenAccount({
      owner: A_POSITION,
      mint: NVDAX_MINT,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const under2022 = await findAssociatedTokenAccount({
      owner: A_POSITION,
      mint: NVDAX_MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    expect(underClassic).not.toBe(under2022);
  });
});
