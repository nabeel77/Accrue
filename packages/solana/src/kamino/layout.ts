import { getBase58Decoder, type Address } from '@solana/kit';

export const RESERVE_ACCOUNT_LENGTH = 8_624;
export const OBLIGATION_ACCOUNT_LENGTH = 3_344;
export const SCOPE_PRICES_ACCOUNT_LENGTH = 28_712;
export const LENDING_MARKET_ACCOUNT_LENGTH = 4_664;

const LENDING_MARKET_AUTODELEVERAGE_ENABLED = 123;

export const SCALED_FRACTION_BITS = 60n;
export const SCALED_FRACTION_ONE = 1n << SCALED_FRACTION_BITS;

const RESERVE_LENDING_MARKET = 32;
const RESERVE_FARM_COLLATERAL = 64;
const RESERVE_FARM_DEBT = 96;
const RESERVE_LIQUIDITY_MINT = 128;
const RESERVE_LIQUIDITY_SUPPLY_VAULT = 160;
const RESERVE_LIQUIDITY_FEE_VAULT = 192;
const RESERVE_LIQUIDITY_AVAILABLE_AMOUNT = 224;
const RESERVE_LIQUIDITY_DEPOSIT_LIMIT_CROSSED = 280;
const RESERVE_LIQUIDITY_BORROW_LIMIT_CROSSED = 288;
const RESERVE_LIQUIDITY_MARKET_PRICE = 248;
const RESERVE_LIQUIDITY_MINT_DECIMALS = 272;
const RESERVE_LIQUIDITY_TOKEN_PROGRAM = 408;
const RESERVE_COLLATERAL_MINT = 2_560;
const RESERVE_COLLATERAL_MINT_TOTAL_SUPPLY = 2_592;
const RESERVE_COLLATERAL_SUPPLY_VAULT = 2_600;
const RESERVE_CONFIG_STATUS = 4_856;
const RESERVE_CONFIG_LOAN_TO_VALUE_PCT = 4_872;
const RESERVE_CONFIG_LIQUIDATION_THRESHOLD_PCT = 4_873;
const RESERVE_CONFIG_AUTODELEVERAGE_ENABLED = 5_502;
const RESERVE_CONFIG_DELEVERAGING_MARGIN_CALL_PERIOD = 4_880;
const RESERVE_CONFIG_BORROW_FACTOR_PCT = 5_008;
const RESERVE_CONFIG_SCOPE_PRICE_ACCOUNT = 5_112;
const RESERVE_CONFIG_SCOPE_PRICE_CHAIN = 5_144;

const OBLIGATION_DEPOSITS = 96;
const OBLIGATION_DEPOSITED_VALUE = 1_192;
const OBLIGATION_BORROWS = 1_208;
const OBLIGATION_BORROWED_ASSETS_MARKET_VALUE = 2_224;
const OBLIGATION_ADJUSTED_DEBT_VALUE = 2_208;
const OBLIGATION_AUTODELEVERAGE_MARGIN_CALL_STARTED = 2_336;
const OBLIGATION_HAS_DEBT = 2_287;
const DEPOSIT_ENTRY_LENGTH = 136;
const DEPOSIT_DEPOSITED_AMOUNT = 32;
const BORROW_ENTRY_LENGTH = 200;
const BORROW_BORROWED_AMOUNT = 88;
const MAX_OBLIGATION_DEPOSITS = 8;
const MAX_OBLIGATION_BORROWS = 5;

const SCOPE_FIRST_PRICE = 40;
const SCOPE_DATED_PRICE_LENGTH = 56;
const SCOPE_PRICE_VALUE = 0;
const SCOPE_PRICE_EXPONENT = 8;
const SCOPE_PRICE_LAST_UPDATED_SLOT = 16;

const RESERVE_STATUS_ACTIVE = 0;
const RESERVE_STATUS_OBSOLETE = 2;
const BASIS_POINTS_PER_PERCENT = 100;
const NO_SCOPE_FEED = 0xffff;

export interface ReserveSnapshot {
  readonly lendingMarket: Address;
  readonly liquidityMint: Address;
  readonly liquidityMintDecimals: number;
  readonly liquidityTokenProgram: Address;
  readonly liquiditySupplyVault: Address;
  readonly liquidityFeeVault: Address;
  readonly liquidityAvailableAmount: bigint;
  readonly liquidityMarketPriceScaled: bigint;
  readonly borrowFactorPct: number;
  readonly depositLimitCrossedTimestamp: bigint;
  readonly borrowLimitCrossedTimestamp: bigint;
  readonly collateralMint: Address;
  readonly collateralMintTotalSupply: bigint;
  readonly collateralSupplyVault: Address;
  readonly maxLoanToValueBps: number;
  readonly liquidationThresholdBps: number;
  readonly isActive: boolean;
  readonly isObsolete: boolean;
  readonly autodeleverageEnabled: boolean;
  readonly deleveragingMarginCallPeriodSeconds: bigint;
  readonly collateralFarm: Address | null;
  readonly debtFarm: Address | null;
  readonly scopePriceAccount: Address;
  readonly scopeFeedIndex: number;
}

export interface ObligationSnapshot {
  readonly depositedValueScaled: bigint;
  readonly borrowedValueScaled: bigint;
  readonly adjustedDebtValueScaled: bigint;
  readonly hasDebt: boolean;
  readonly autodeleverageMarginCallStartedTimestamp: bigint;
  readonly loanToValueBps: number;
  readonly depositReserves: readonly Address[];
  readonly borrowReserves: readonly Address[];
  depositedAmountFor(reserve: Address): bigint;
  borrowedAmountScaledFor(reserve: Address): bigint;
}

export interface ScopePrice {
  readonly value: bigint;
  readonly exponent: bigint;
  readonly lastUpdatedSlot: bigint;
}

function addressAt(data: Uint8Array, offset: number): Address {
  return getBase58Decoder().decode(data.subarray(offset, offset + 32)) as Address;
}

function unsignedAt(data: Uint8Array, offset: number, byteLength: number): bigint {
  let value = 0n;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return value;
}

export function decodeReserve(data: Uint8Array): ReserveSnapshot {
  if (data.length !== RESERVE_ACCOUNT_LENGTH) {
    throw new Error('that account is not the length a lending market reserve is');
  }

  const status = data[RESERVE_CONFIG_STATUS] ?? 0;
  const autodeleverage = (data[RESERVE_CONFIG_AUTODELEVERAGE_ENABLED] ?? 0) !== 0;
  const depositLimitCrossedTimestamp = unsignedAt(
    data,
    RESERVE_LIQUIDITY_DEPOSIT_LIMIT_CROSSED,
    8,
  );
  const borrowLimitCrossedTimestamp = unsignedAt(
    data,
    RESERVE_LIQUIDITY_BORROW_LIMIT_CROSSED,
    8,
  );

  const collateralFarm = addressAt(data, RESERVE_FARM_COLLATERAL);
  const debtFarm = addressAt(data, RESERVE_FARM_DEBT);
  const scopeFeedIndex = Number(unsignedAt(data, RESERVE_CONFIG_SCOPE_PRICE_CHAIN, 2));

  return {
    lendingMarket: addressAt(data, RESERVE_LENDING_MARKET),
    liquidityMint: addressAt(data, RESERVE_LIQUIDITY_MINT),
    liquidityMintDecimals: Number(unsignedAt(data, RESERVE_LIQUIDITY_MINT_DECIMALS, 8)),
    liquidityTokenProgram: addressAt(data, RESERVE_LIQUIDITY_TOKEN_PROGRAM),
    liquiditySupplyVault: addressAt(data, RESERVE_LIQUIDITY_SUPPLY_VAULT),
    liquidityFeeVault: addressAt(data, RESERVE_LIQUIDITY_FEE_VAULT),
    liquidityAvailableAmount: unsignedAt(data, RESERVE_LIQUIDITY_AVAILABLE_AMOUNT, 8),
    liquidityMarketPriceScaled: unsignedAt(data, RESERVE_LIQUIDITY_MARKET_PRICE, 16),
    borrowFactorPct: Number(unsignedAt(data, RESERVE_CONFIG_BORROW_FACTOR_PCT, 8)),
    depositLimitCrossedTimestamp,
    borrowLimitCrossedTimestamp,
    collateralMint: addressAt(data, RESERVE_COLLATERAL_MINT),
    collateralMintTotalSupply: unsignedAt(data, RESERVE_COLLATERAL_MINT_TOTAL_SUPPLY, 8),
    collateralSupplyVault: addressAt(data, RESERVE_COLLATERAL_SUPPLY_VAULT),
    maxLoanToValueBps:
      (data[RESERVE_CONFIG_LOAN_TO_VALUE_PCT] ?? 0) * BASIS_POINTS_PER_PERCENT,
    liquidationThresholdBps:
      (data[RESERVE_CONFIG_LIQUIDATION_THRESHOLD_PCT] ?? 0) * BASIS_POINTS_PER_PERCENT,
    isActive: status === RESERVE_STATUS_ACTIVE,
    isObsolete: status === RESERVE_STATUS_OBSOLETE,
    autodeleverageEnabled: autodeleverage,
    deleveragingMarginCallPeriodSeconds: unsignedAt(
      data,
      RESERVE_CONFIG_DELEVERAGING_MARGIN_CALL_PERIOD,
      8,
    ),
    collateralFarm: isTheDefaultAddress(collateralFarm) ? null : collateralFarm,
    debtFarm: isTheDefaultAddress(debtFarm) ? null : debtFarm,
    scopePriceAccount: addressAt(data, RESERVE_CONFIG_SCOPE_PRICE_ACCOUNT),
    scopeFeedIndex,
  };
}

export function reserveNamesAScopeFeed(reserve: ReserveSnapshot): boolean {
  return reserve.scopeFeedIndex !== NO_SCOPE_FEED;
}

export function decodeObligation(data: Uint8Array): ObligationSnapshot {
  if (data.length !== OBLIGATION_ACCOUNT_LENGTH) {
    throw new Error('that account is not the length a lending market obligation is');
  }

  const depositedValueScaled = unsignedAt(data, OBLIGATION_DEPOSITED_VALUE, 16);
  const borrowedValueScaled = unsignedAt(
    data,
    OBLIGATION_BORROWED_ASSETS_MARKET_VALUE,
    16,
  );
  const adjustedDebtValueScaled = unsignedAt(data, OBLIGATION_ADJUSTED_DEBT_VALUE, 16);

  const depositReserves: Address[] = [];
  for (let index = 0; index < MAX_OBLIGATION_DEPOSITS; index += 1) {
    const reserve = addressAt(data, OBLIGATION_DEPOSITS + index * DEPOSIT_ENTRY_LENGTH);
    if (!isTheDefaultAddress(reserve)) {
      depositReserves.push(reserve);
    }
  }
  const borrowReserves: Address[] = [];
  for (let index = 0; index < MAX_OBLIGATION_BORROWS; index += 1) {
    const reserve = addressAt(data, OBLIGATION_BORROWS + index * BORROW_ENTRY_LENGTH);
    if (!isTheDefaultAddress(reserve)) {
      borrowReserves.push(reserve);
    }
  }

  return {
    depositedValueScaled,
    borrowedValueScaled,
    adjustedDebtValueScaled,
    depositReserves,
    borrowReserves,
    hasDebt: (data[OBLIGATION_HAS_DEBT] ?? 0) !== 0,
    autodeleverageMarginCallStartedTimestamp: unsignedAt(
      data,
      OBLIGATION_AUTODELEVERAGE_MARGIN_CALL_STARTED,
      8,
    ),
    loanToValueBps:
      depositedValueScaled === 0n
        ? 0
        : Number((adjustedDebtValueScaled * 10_000n) / depositedValueScaled),
    depositedAmountFor(reserve: Address): bigint {
      for (let index = 0; index < MAX_OBLIGATION_DEPOSITS; index += 1) {
        const base = OBLIGATION_DEPOSITS + index * DEPOSIT_ENTRY_LENGTH;
        if (addressAt(data, base) === reserve) {
          return unsignedAt(data, base + DEPOSIT_DEPOSITED_AMOUNT, 8);
        }
      }
      return 0n;
    },
    borrowedAmountScaledFor(reserve: Address): bigint {
      for (let index = 0; index < MAX_OBLIGATION_BORROWS; index += 1) {
        const base = OBLIGATION_BORROWS + index * BORROW_ENTRY_LENGTH;
        if (addressAt(data, base) === reserve) {
          return unsignedAt(data, base + BORROW_BORROWED_AMOUNT, 16);
        }
      }
      return 0n;
    },
  };
}

export function decodeScopePrice(data: Uint8Array, feedIndex: number): ScopePrice {
  if (data.length !== SCOPE_PRICES_ACCOUNT_LENGTH) {
    throw new Error('that account is not the length an oracle price account is');
  }
  const base = SCOPE_FIRST_PRICE + feedIndex * SCOPE_DATED_PRICE_LENGTH;
  return {
    value: unsignedAt(data, base + SCOPE_PRICE_VALUE, 8),
    exponent: unsignedAt(data, base + SCOPE_PRICE_EXPONENT, 8),
    lastUpdatedSlot: unsignedAt(data, base + SCOPE_PRICE_LAST_UPDATED_SLOT, 8),
  };
}

export function scaledFractionToWholeUnits(scaled: bigint): bigint {
  return scaled >> SCALED_FRACTION_BITS;
}

function isTheDefaultAddress(candidate: Address): boolean {
  return candidate === '11111111111111111111111111111111';
}

export interface LendingMarketSnapshot {
  readonly autodeleverageEnabled: boolean;
}

export function decodeLendingMarket(data: Uint8Array): LendingMarketSnapshot {
  if (data.length !== LENDING_MARKET_ACCOUNT_LENGTH) {
    throw new Error('that account is not the length a lending market is');
  }
  return {
    autodeleverageEnabled: (data[LENDING_MARKET_AUTODELEVERAGE_ENABLED] ?? 0) !== 0,
  };
}
