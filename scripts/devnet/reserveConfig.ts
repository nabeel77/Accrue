import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getAddressEncoder, type Address } from '@solana/kit';

import { UpdateConfigMode } from '@accrue/solana/kamino';

import type { SandboxToken } from './tokens.js';

/**
 * Every ReserveConfig field lives at a fixed offset inside the reserve account, so the mainnet
 * fixture the sandbox copies from is read straight out of its bytes. Anything this list does not
 * name keeps whatever init_reserve wrote.
 */
const RESERVE_CONFIG_OFFSETS = {
  minDeleveragingBonusBps: 4_860,
  earlyRepayRemainingInterestPct: 4_863,
  protocolOrderExecutionFeePct: 4_869,
  protocolTakeRatePct: 4_870,
  protocolLiquidationFeePct: 4_871,
  loanToValuePct: 4_872,
  liquidationThresholdPct: 4_873,
  minLiquidationBonusBps: 4_874,
  maxLiquidationBonusBps: 4_876,
  badDebtLiquidationBonusBps: 4_878,
  deleveragingMarginCallPeriodSeconds: 4_880,
  deleveragingThresholdDecreaseBpsPerDay: 4_888,
  originationFeeScaled: 4_896,
  flashLoanFeeScaled: 4_904,
  borrowRateCurve: 4_920,
  borrowFactorPct: 5_008,
  heuristicLower: 5_064,
  heuristicUpper: 5_072,
  heuristicExponent: 5_080,
  deleveragingBonusIncreaseBpsPerDay: 5_768,
} as const;

const BORROW_RATE_CURVE_LENGTH = 88;
const ELEVATION_GROUPS_LENGTH = 20;
const ELEVATION_GROUP_BORROW_LIMITS_LENGTH = 8 * 32;
const A_LIMIT_NO_SANDBOX_POSITION_REACHES = 2n ** 53n;
const NO_SCOPE_FEED = 65_535;
const PRICE_MAX_AGE_SECONDS = 3_600n;
const DEFAULT_ADDRESS = '11111111111111111111111111111111' as Address;
const NO_SEPARATE_LIMIT_OUTSIDE_ELEVATION_GROUPS = 2n ** 64n - 1n;

export interface ConfigWrite {
  readonly what: string;
  readonly mode: UpdateConfigMode;
  readonly value: Uint8Array;
}

function unsigned(value: bigint, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let remaining = value;
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function nullPaddedName(name: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(name).subarray(0, 32));
  return bytes;
}

function scopeChain(feedIndex: number): Uint8Array {
  const chain = [feedIndex, NO_SCOPE_FEED, NO_SCOPE_FEED, NO_SCOPE_FEED];
  const bytes = new Uint8Array(8);
  chain.forEach((entry, index) => {
    bytes.set(unsigned(BigInt(entry), 2), index * 2);
  });
  return bytes;
}

const NO_SCOPE_CHAIN = scopeChain(NO_SCOPE_FEED);

export function readTemplateReserve(fixtureName: string): Uint8Array {
  const path = resolve(
    import.meta.dirname,
    '../../tests/fixtures/accounts',
    `${fixtureName}.json`,
  );
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as { data_base64: string };
  return Uint8Array.from(Buffer.from(fixture.data_base64, 'base64'));
}

function slice(template: Uint8Array, offset: number, byteLength: number): Uint8Array {
  return template.slice(offset, offset + byteLength);
}

/**
 * The risk numbers come from the mainnet reserve this one stands in for, so a sandbox position
 * liquidates at the same loan to value a real one would. Everything else is a sandbox choice:
 * our own oracle, limits nothing here can reach, no farms and no elevation groups.
 */
export function reserveConfigWrites(
  token: SandboxToken,
  template: Uint8Array,
  pricesAccount: Address,
): readonly ConfigWrite[] {
  const fromTemplate = (
    what: string,
    mode: UpdateConfigMode,
    offset: number,
    byteLength: number,
  ): ConfigWrite => ({ what, mode, value: slice(template, offset, byteLength) });

  const offsets = RESERVE_CONFIG_OFFSETS;
  return [
    fromTemplate(
      'loan to value',
      UpdateConfigMode.UpdateLoanToValuePct,
      offsets.loanToValuePct,
      1,
    ),
    fromTemplate(
      'liquidation threshold',
      UpdateConfigMode.UpdateLiquidationThresholdPct,
      offsets.liquidationThresholdPct,
      1,
    ),
    fromTemplate(
      'max liquidation bonus',
      UpdateConfigMode.UpdateMaxLiquidationBonusBps,
      offsets.maxLiquidationBonusBps,
      2,
    ),
    fromTemplate(
      'min liquidation bonus',
      UpdateConfigMode.UpdateMinLiquidationBonusBps,
      offsets.minLiquidationBonusBps,
      2,
    ),
    fromTemplate(
      'bad debt liquidation bonus',
      UpdateConfigMode.UpdateBadDebtLiquidationBonusBps,
      offsets.badDebtLiquidationBonusBps,
      2,
    ),
    fromTemplate(
      'min deleveraging bonus',
      UpdateConfigMode.UpdateMinDeleveragingBonusBps,
      offsets.minDeleveragingBonusBps,
      2,
    ),
    fromTemplate(
      'protocol liquidation fee',
      UpdateConfigMode.UpdateProtocolLiquidationFee,
      offsets.protocolLiquidationFeePct,
      1,
    ),
    fromTemplate(
      'protocol take rate',
      UpdateConfigMode.UpdateProtocolTakeRate,
      offsets.protocolTakeRatePct,
      1,
    ),
    fromTemplate(
      'protocol order execution fee',
      UpdateConfigMode.UpdateProtocolOrderExecutionFee,
      offsets.protocolOrderExecutionFeePct,
      1,
    ),
    fromTemplate(
      'origination fee',
      UpdateConfigMode.UpdateFeesOriginationFee,
      offsets.originationFeeScaled,
      8,
    ),
    fromTemplate(
      'flash loan fee',
      UpdateConfigMode.UpdateFeesFlashLoanFee,
      offsets.flashLoanFeeScaled,
      8,
    ),
    fromTemplate(
      'borrow rate curve',
      UpdateConfigMode.UpdateBorrowRateCurve,
      offsets.borrowRateCurve,
      BORROW_RATE_CURVE_LENGTH,
    ),
    fromTemplate(
      'borrow factor',
      UpdateConfigMode.UpdateBorrowFactor,
      offsets.borrowFactorPct,
      8,
    ),
    fromTemplate(
      'margin call period',
      UpdateConfigMode.UpdateDeleveragingMarginCallPeriod,
      offsets.deleveragingMarginCallPeriodSeconds,
      8,
    ),
    fromTemplate(
      'deleveraging threshold decrease',
      UpdateConfigMode.UpdateDeleveragingThresholdDecreaseBpsPerDay,
      offsets.deleveragingThresholdDecreaseBpsPerDay,
      8,
    ),
    fromTemplate(
      'deleveraging bonus increase',
      UpdateConfigMode.UpdateDeleveragingBonusIncreaseBpsPerDay,
      offsets.deleveragingBonusIncreaseBpsPerDay,
      8,
    ),
    fromTemplate(
      'price heuristic lower',
      UpdateConfigMode.UpdateTokenInfoLowerHeuristic,
      offsets.heuristicLower,
      8,
    ),
    fromTemplate(
      'price heuristic upper',
      UpdateConfigMode.UpdateTokenInfoUpperHeuristic,
      offsets.heuristicUpper,
      8,
    ),
    fromTemplate(
      'price heuristic exponent',
      UpdateConfigMode.UpdateTokenInfoExpHeuristic,
      offsets.heuristicExponent,
      8,
    ),
    {
      what: 'token name',
      mode: UpdateConfigMode.UpdateTokenInfoName,
      value: nullPaddedName(token.name),
    },
    {
      what: 'scope price account',
      mode: UpdateConfigMode.UpdateScopePriceFeed,
      value: new Uint8Array(getAddressEncoder().encode(pricesAccount)),
    },
    {
      what: 'scope price chain',
      mode: UpdateConfigMode.UpdateTokenInfoScopeChain,
      value: scopeChain(token.feedIndex),
    },
    {
      what: 'scope twap chain',
      mode: UpdateConfigMode.UpdateTokenInfoScopeTwap,
      value: NO_SCOPE_CHAIN,
    },
    {
      what: 'twap divergence',
      mode: UpdateConfigMode.UpdateTokenInfoTwapDivergence,
      value: unsigned(0n, 8),
    },
    {
      what: 'price max age',
      mode: UpdateConfigMode.UpdateTokenInfoPriceMaxAge,
      value: unsigned(PRICE_MAX_AGE_SECONDS, 8),
    },
    {
      what: 'twap max age',
      mode: UpdateConfigMode.UpdateTokenInfoTwapMaxAge,
      value: unsigned(0n, 8),
    },
    {
      what: 'borrow limit outside elevation groups',
      mode: UpdateConfigMode.UpdateBorrowLimitOutsideElevationGroup,
      value: unsigned(NO_SEPARATE_LIMIT_OUTSIDE_ELEVATION_GROUPS, 8),
    },
    {
      what: 'borrow limits in elevation groups',
      mode: UpdateConfigMode.UpdateBorrowLimitsInElevationGroupAgainstThisReserve,
      value: new Uint8Array(ELEVATION_GROUP_BORROW_LIMITS_LENGTH),
    },
    {
      what: 'deposit withdrawal cap',
      mode: UpdateConfigMode.UpdateDepositWithdrawalCap,
      value: new Uint8Array([
        ...unsigned(A_LIMIT_NO_SANDBOX_POSITION_REACHES, 8),
        ...unsigned(0n, 8),
      ]),
    },
    {
      what: 'debt withdrawal cap',
      mode: UpdateConfigMode.UpdateDebtWithdrawalCap,
      value: new Uint8Array([
        ...unsigned(A_LIMIT_NO_SANDBOX_POSITION_REACHES, 8),
        ...unsigned(0n, 8),
      ]),
    },
    {
      what: 'elevation groups',
      mode: UpdateConfigMode.UpdateElevationGroup,
      value: new Uint8Array(ELEVATION_GROUPS_LENGTH),
    },
    {
      what: 'collateral farm',
      mode: UpdateConfigMode.UpdateFarmCollateral,
      value: new Uint8Array(getAddressEncoder().encode(DEFAULT_ADDRESS)),
    },
    {
      what: 'debt farm',
      mode: UpdateConfigMode.UpdateFarmDebt,
      value: new Uint8Array(getAddressEncoder().encode(DEFAULT_ADDRESS)),
    },
    {
      what: 'autodeleverage',
      mode: UpdateConfigMode.UpdateAutodeleverageEnabled,
      value: unsigned(0n, 1),
    },
    {
      what: 'block borrowing above utilisation',
      mode: UpdateConfigMode.UpdateBlockBorrowingAboveUtilizationPct,
      value: unsigned(0n, 1),
    },
    {
      what: 'block price usage',
      mode: UpdateConfigMode.UpdateBlockPriceUsage,
      value: unsigned(0n, 1),
    },
    {
      what: 'block ctoken usage',
      mode: UpdateConfigMode.UpdateBlockCTokenUsage,
      value: unsigned(0n, 1),
    },
    {
      what: 'usage as collateral outside elevation groups',
      mode: UpdateConfigMode.UpdateDisableUsageAsCollateralOutsideEmode,
      value: unsigned(0n, 1),
    },
    {
      what: 'host fixed interest rate',
      mode: UpdateConfigMode.UpdateHostFixedInterestRateBps,
      value: unsigned(0n, 2),
    },
    fromTemplate(
      'early repay remaining interest',
      UpdateConfigMode.UpdateEarlyRepayRemainingInterestPct,
      offsets.earlyRepayRemainingInterestPct,
      1,
    ),
  ];
}

/**
 * A reserve counts as blocked while both of its limits are zero, and only a blocked reserve may
 * take a config write that skips validation. So the limits and the status go last, together, with
 * the market's own integrity check running on every one of them.
 */
export function reserveOpeningWrites(): readonly ConfigWrite[] {
  return [
    {
      what: 'deposit limit',
      mode: UpdateConfigMode.UpdateDepositLimit,
      value: unsigned(A_LIMIT_NO_SANDBOX_POSITION_REACHES, 8),
    },
    {
      what: 'borrow limit',
      mode: UpdateConfigMode.UpdateBorrowLimit,
      value: unsigned(A_LIMIT_NO_SANDBOX_POSITION_REACHES, 8),
    },
    {
      what: 'reserve status',
      mode: UpdateConfigMode.UpdateReserveStatus,
      value: new Uint8Array([0]),
    },
  ];
}
