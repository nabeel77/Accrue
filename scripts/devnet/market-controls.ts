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

const MARKET_SETTING_LENGTH = 72;

/** The market refuses to mark any one obligation until it carries its own margin call period. */
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

  const [what, first, second] = process.argv.slice(2);
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
    'say reserve-status <symbol> <active|obsolete|hidden>, individual-deleverage-period <seconds>, or mark-for-deleveraging <obligation> <target ltv percent, or 255 to clear>',
  );
}

await main();
