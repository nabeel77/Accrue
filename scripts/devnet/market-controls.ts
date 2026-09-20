import {
  address,
  getProgramDerivedAddress,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';

import {
  getMarkObligationForDeleveragingInstruction,
  getUpdateLendingMarketInstruction,
  getUpdateReserveConfigInstruction,
  UpdateConfigMode,
  UpdateLendingMarketMode,
} from '@accrue/solana/kamino';
import { INSTRUCTIONS_SYSVAR_ADDRESS } from '@accrue/solana';

import {
  adminSigner,
  connectToDevnet,
  namedSigner,
  readRegistry,
  reportSignature,
  reportStep,
  sendInstructions,
  type Cluster,
} from './shared.js';
import { tokenBySymbol } from './tokens.js';

const RESERVE_STATUSES: Readonly<Record<string, number>> = {
  active: 0,
  obsolete: 1,
  hidden: 2,
};

// The market clears the marker on this one value, not on zero, which is a real target.
const CLEAR_THE_DELEVERAGING_MARKER = 255;

function globalConfigSeed(): Uint8Array {
  return new TextEncoder().encode('global_config');
}

async function reserveStatus(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  reserve: Address,
  status: string,
): Promise<void> {
  const value = RESERVE_STATUSES[status];
  if (value === undefined) {
    throw new Error(`${status} is not active, obsolete or hidden`);
  }
  const [globalConfig] = await getProgramDerivedAddress({
    programAddress: lending,
    seeds: [globalConfigSeed()],
  });

  const signature = await sendInstructions(cluster, admin, [
    getUpdateReserveConfigInstruction(
      {
        signer: admin,
        globalConfig,
        lendingMarket: market,
        reserve,
        instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
        mode: UpdateConfigMode.UpdateReserveStatus,
        value: new Uint8Array([value]),
        skipConfigIntegrityValidation: false,
      },
      { programAddress: lending },
    ),
  ]);
  reportSignature(`reserve status set to ${status}`, signature);
}

const WITHDRAWAL_CAP_LENGTH = 16;

// The market writes the capacity and the window length together, and a window of zero means no cap.
async function withdrawalCap(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  reserve: Address,
  capacityRaw: bigint,
  windowSeconds: bigint,
): Promise<void> {
  const [globalConfig] = await getProgramDerivedAddress({
    programAddress: lending,
    seeds: [globalConfigSeed()],
  });
  const value = new Uint8Array(WITHDRAWAL_CAP_LENGTH);
  writeUnsigned(value, 0, capacityRaw);
  writeUnsigned(value, 8, windowSeconds);

  const signature = await sendInstructions(cluster, admin, [
    getUpdateReserveConfigInstruction(
      {
        signer: admin,
        globalConfig,
        lendingMarket: market,
        reserve,
        instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
        mode: UpdateConfigMode.UpdateDepositWithdrawalCap,
        value,
        skipConfigIntegrityValidation: false,
      },
      { programAddress: lending },
    ),
  ]);
  reportSignature(
    windowSeconds === 0n
      ? 'the withdrawal cap is off'
      : `the withdrawal cap is ${capacityRaw} raw every ${windowSeconds} seconds`,
    signature,
  );
}

const CURVE_POINTS = 11;
const FULL_UTILISATION_BPS = 10_000;

// Eleven points of utilisation and rate, both in basis points. The market wants them sorted, the
// first at no utilisation, the last at full, and every point after full a copy of it.
function borrowRateCurveBytes(baseRateBps: number): Uint8Array {
  const shape: readonly (readonly [number, number])[] = [
    [0, baseRateBps],
    [8_000, baseRateBps * 2],
    [9_500, baseRateBps * 4],
    [FULL_UTILISATION_BPS, baseRateBps * 8],
  ];
  const last = shape[shape.length - 1];
  if (last === undefined) {
    throw new Error('the curve needs at least one point');
  }
  const bytes = new Uint8Array(CURVE_POINTS * 8);
  for (let index = 0; index < CURVE_POINTS; index += 1) {
    const [utilisation, rate] = shape[index] ?? last;
    writeUnsigned32(bytes, index * 8, utilisation);
    writeUnsigned32(bytes, index * 8 + 4, rate);
  }
  return bytes;
}

// The rate a loan costs at today's utilisation, which on the sandbox is near nothing, so the
// first point of the curve is what a borrower actually pays.
async function borrowRate(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  reserve: Address,
  baseRateBps: number,
): Promise<void> {
  const [globalConfig] = await getProgramDerivedAddress({
    programAddress: lending,
    seeds: [globalConfigSeed()],
  });
  const signature = await sendInstructions(cluster, admin, [
    getUpdateReserveConfigInstruction(
      {
        signer: admin,
        globalConfig,
        lendingMarket: market,
        reserve,
        instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
        mode: UpdateConfigMode.UpdateBorrowRateCurve,
        value: borrowRateCurveBytes(baseRateBps),
        skipConfigIntegrityValidation: false,
      },
      { programAddress: lending },
    ),
  ]);
  reportSignature(
    `the borrow rate curve starts at ${(baseRateBps / 100).toFixed(2)} percent and reaches ${((baseRateBps * 8) / 100).toFixed(2)} percent at full utilisation`,
    signature,
  );
}

function writeUnsigned32(into: Uint8Array, at: number, value: number): void {
  let remaining = value;
  for (let index = 0; index < 4; index += 1) {
    into[at + index] = remaining & 0xff;
    remaining >>>= 8;
  }
}

function writeUnsigned(into: Uint8Array, at: number, value: bigint): void {
  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    into[at + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

const HEURISTIC_EXPONENT = 8;

async function priceBand(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  reserve: Address,
  lowest: number,
  highest: number,
): Promise<void> {
  const [globalConfig] = await getProgramDerivedAddress({
    programAddress: lending,
    seeds: [globalConfigSeed()],
  });
  const scale = 10 ** HEURISTIC_EXPONENT;
  const write = (mode: UpdateConfigMode, value: bigint) => {
    const bytes = new Uint8Array(8);
    writeUnsigned(bytes, 0, value);
    return getUpdateReserveConfigInstruction(
      {
        signer: admin,
        globalConfig,
        lendingMarket: market,
        reserve,
        instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
        mode,
        value: bytes,
        skipConfigIntegrityValidation: false,
      },
      { programAddress: lending },
    );
  };
  const signature = await sendInstructions(cluster, admin, [
    write(UpdateConfigMode.UpdateTokenInfoExpHeuristic, BigInt(HEURISTIC_EXPONENT)),
    write(
      UpdateConfigMode.UpdateTokenInfoLowerHeuristic,
      BigInt(Math.round(lowest * scale)),
    ),
    write(
      UpdateConfigMode.UpdateTokenInfoUpperHeuristic,
      BigInt(Math.round(highest * scale)),
    ),
  ]);
  reportSignature(`the price band is now ${lowest} to ${highest}`, signature);
}

const MARKET_SETTING_LENGTH = 72;

// The market refuses to mark any one obligation until it carries its own margin call period.
async function individualDeleveragePeriod(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  seconds: number,
): Promise<void> {
  const value = new Uint8Array(MARKET_SETTING_LENGTH);
  let remaining = BigInt(seconds);
  for (let index = 0; index < 8; index += 1) {
    value[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  const signature = await sendInstructions(cluster, admin, [
    getUpdateLendingMarketInstruction(
      {
        signer: admin,
        lendingMarket: market,
        instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
        mode: BigInt(
          UpdateLendingMarketMode.UpdateIndividualAutodeleverageMarginCallPeriodSecs,
        ),
        value,
      },
      { programAddress: lending },
    ),
  ]);
  reportSignature(`the market's own margin call period is ${seconds} seconds`, signature);
}

async function markForDeleveraging(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  obligation: Address,
  targetLtvPct: number,
): Promise<void> {
  const signature = await sendInstructions(cluster, admin, [
    getMarkObligationForDeleveragingInstruction(
      {
        lendingMarketOwner: admin,
        obligation,
        lendingMarket: market,
        instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
        autodeleverageTargetLtvPct: targetLtvPct,
      },
      { programAddress: lending },
    ),
  ]);
  reportSignature(
    targetLtvPct === CLEAR_THE_DELEVERAGING_MARKER
      ? 'the deleveraging marker is cleared'
      : `the obligation is marked for deleveraging down to ${targetLtvPct} percent`,
    signature,
  );
}

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const admin = await adminSigner();
  const registry = readRegistry();
  const lending = (await namedSigner('klend')).address;
  const market = registry.market as Address | undefined;
  if (market === undefined) {
    throw new Error('the lending market is not in the devnet registry yet');
  }

  const [what, first, second, third] = process.argv.slice(2);
  if (what === 'reserve-status') {
    const token = tokenBySymbol(first ?? '');
    const reserve = registry.reserves?.[token.symbol];
    if (reserve === undefined) {
      throw new Error(`${token.symbol} has no reserve in the devnet registry`);
    }
    reportStep(`${token.symbol} reserve ${reserve}`);
    await reserveStatus(
      cluster,
      admin,
      lending,
      market,
      reserve as Address,
      second ?? 'active',
    );
    return;
  }

  if (what === 'withdrawal-cap') {
    const token = tokenBySymbol(first ?? '');
    const reserve = registry.reserves?.[token.symbol];
    if (reserve === undefined) {
      throw new Error(`${token.symbol} has no reserve in the devnet registry`);
    }
    await withdrawalCap(
      cluster,
      admin,
      lending,
      market,
      reserve as Address,
      BigInt(second ?? '0'),
      BigInt(third ?? '0'),
    );
    return;
  }

  if (what === 'borrow-rate') {
    const token = tokenBySymbol(first ?? '');
    const reserve = registry.reserves?.[token.symbol];
    if (reserve === undefined) {
      throw new Error(`${token.symbol} has no reserve in the devnet registry`);
    }
    const baseRateBps = Number(second ?? 0);
    if (!Number.isInteger(baseRateBps) || baseRateBps <= 0) {
      throw new Error('give the rate in basis points, for example 500 for 5 percent');
    }
    reportStep(`${token.symbol} reserve ${reserve}`);
    await borrowRate(cluster, admin, lending, market, reserve as Address, baseRateBps);
    return;
  }

  if (what === 'price-band') {
    const token = tokenBySymbol(first ?? '');
    const reserve = registry.reserves?.[token.symbol];
    if (reserve === undefined) {
      throw new Error(`${token.symbol} has no reserve in the devnet registry`);
    }
    const lowest = Number(second ?? 0);
    const highest = Number(third ?? 0);
    if (!(lowest > 0) || !(highest > lowest)) {
      throw new Error('give a lowest and a highest price, for example 0.95 12');
    }
    reportStep(`${token.symbol} reserve ${reserve}`);
    await priceBand(cluster, admin, lending, market, reserve as Address, lowest, highest);
    return;
  }

  if (what === 'individual-deleverage-period') {
    await individualDeleveragePeriod(cluster, admin, lending, market, Number(first ?? 0));
    return;
  }

  if (what === 'mark-for-deleveraging') {
    if (first === undefined) {
      throw new Error('name the obligation to mark');
    }
    await markForDeleveraging(
      cluster,
      admin,
      lending,
      market,
      address(first),
      Number(second ?? CLEAR_THE_DELEVERAGING_MARKER),
    );
    return;
  }

  throw new Error(
    'say reserve-status <symbol> <active|obsolete|hidden>, borrow-rate <symbol> <basis points at no utilisation>, withdrawal-cap <symbol> <capacity raw> <window seconds, 0 for no cap>, price-band <symbol> <lowest> <highest>, individual-deleverage-period <seconds>, or mark-for-deleveraging <obligation> <target ltv percent, or 255 to clear>',
  );
}

await main();
