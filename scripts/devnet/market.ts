import { getCreateAccountInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
} from '@solana-program/token-2022';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';

import {
  getDepositReserveLiquidityInstruction,
  getInitGlobalConfigInstruction,
  getInitLendingMarketInstruction,
  getInitReserveInstruction,
  getUpdateLendingMarketInstruction,
  getUpdateReserveConfigInstruction,
  UpdateLendingMarketMode,
} from '@accrue/solana/kamino';
import {
  INSTRUCTIONS_SYSVAR_ADDRESS,
  RENT_SYSVAR_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
} from '@accrue/solana';

import {
  accountData,
  accountOwner,
  adminSigner,
  connectToDevnet,
  explorerAddressLink,
  mergeIntoRegistry,
  namedSigner,
  readRegistry,
  reportSignature,
  reportStep,
  sendInstructions,
  type Cluster,
} from './shared.js';
import { mintKeypairName, tokenProgramAddress } from './mints.js';
import {
  readTemplateReserve,
  reserveConfigWrites,
  reserveOpeningWrites,
} from './reserveConfig.js';
import { SANDBOX_TOKENS, wholeUnits, type SandboxToken } from './tokens.js';

const LENDING_MARKET_ACCOUNT_LENGTH = 4_664n;
const RESERVE_ACCOUNT_LENGTH = 8_624n;
const BPF_UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111' as Address;
const QUOTE_CURRENCY = 'USD';
const MARKET_NAME = 'Accrue devnet sandbox';
const USDC_LIQUIDITY_TO_SEED = 1_000_000;
const WRITES_PER_TRANSACTION = 6;

const encoder = getAddressEncoder();

function seedOf(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function addressSeed(value: Address): Uint8Array {
  return new Uint8Array(encoder.encode(value));
}

function paddedTo(value: string, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set(new TextEncoder().encode(value).subarray(0, byteLength));
  return bytes;
}

async function derive(programAddress: Address, seeds: Uint8Array[]): Promise<Address> {
  const [found] = await getProgramDerivedAddress({ programAddress, seeds });
  return found;
}

interface ReservePdas {
  readonly liquiditySupply: Address;
  readonly feeReceiver: Address;
  readonly collateralMint: Address;
  readonly collateralSupply: Address;
}

async function reservePdas(lending: Address, reserve: Address): Promise<ReservePdas> {
  const of = async (seed: string): Promise<Address> =>
    derive(lending, [seedOf(seed), addressSeed(reserve)]);
  return {
    liquiditySupply: await of('reserve_liq_supply'),
    feeReceiver: await of('fee_receiver'),
    collateralMint: await of('reserve_coll_mint'),
    collateralSupply: await of('reserve_coll_supply'),
  };
}

async function ensureTheGlobalConfigExists(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
): Promise<Address> {
  const globalConfig = await derive(lending, [seedOf('global_config')]);
  if ((await accountOwner(cluster, globalConfig)) !== null) {
    reportStep(`  global config       ${globalConfig}  already there`);
    return globalConfig;
  }
  const programData = await derive(BPF_UPGRADEABLE_LOADER, [addressSeed(lending)]);
  const signature = await sendInstructions(cluster, admin, [
    getInitGlobalConfigInstruction(
      {
        payer: admin,
        globalConfig,
        programData,
        systemProgram: SYSTEM_PROGRAM_ADDRESS,
        rent: RENT_SYSVAR_ADDRESS,
        instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
      },
      { programAddress: lending },
    ),
  ]);
  reportStep(`  global config       ${globalConfig}`);
  reportSignature('global config created', signature);
  return globalConfig;
}

async function ensureTheMarketExists(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
): Promise<Address> {
  const market = await namedSigner('market');
  const marketAuthority = await derive(lending, [
    seedOf('lma'),
    addressSeed(market.address),
  ]);

  const marketOwner = await accountOwner(cluster, market.address);
  if (marketOwner === lending) {
    reportStep(`  lending market      ${market.address}  already there`);
    return market.address;
  }
  if (marketOwner !== null) {
    throw new Error(
      `${market.address} is owned by ${marketOwner}, not by ${lending}. Move its keypair out of the devnet folder so a new market is made.`,
    );
  }

  const lamports = await cluster.rpc
    .getMinimumBalanceForRentExemption(LENDING_MARKET_ACCOUNT_LENGTH)
    .send();
  await sendInstructions(
    cluster,
    admin,
    [
      getCreateAccountInstruction({
        payer: admin,
        newAccount: market,
        lamports,
        space: LENDING_MARKET_ACCOUNT_LENGTH,
        programAddress: lending,
      }),
    ],
    { extraSigners: [market] },
  );
  const created = await sendInstructions(cluster, admin, [
    getInitLendingMarketInstruction(
      {
        lendingMarketOwner: admin,
        lendingMarket: market.address,
        lendingMarketAuthority: marketAuthority,
        systemProgram: SYSTEM_PROGRAM_ADDRESS,
        rent: RENT_SYSVAR_ADDRESS,
        instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
        quoteCurrency: paddedTo(QUOTE_CURRENCY, 32),
      },
      { programAddress: lending },
    ),
  ]);
  reportStep(`  lending market      ${market.address}`);
  reportSignature('market created', created);

  const settings: readonly {
    what: string;
    mode: UpdateLendingMarketMode;
    value: Uint8Array;
  }[] = [
    {
      what: 'name',
      mode: UpdateLendingMarketMode.UpdateName,
      value: paddedTo(MARKET_NAME, 32),
    },
    {
      what: 'risk council',
      mode: UpdateLendingMarketMode.UpdateEmergencyCouncil,
      value: addressSeed(admin.address),
    },
    {
      what: 'autodeleverage',
      mode: UpdateLendingMarketMode.UpdateAutodeleverageEnabled,
      value: new Uint8Array(1),
    },
  ];
  for (const setting of settings) {
    const signature = await sendInstructions(cluster, admin, [
      getUpdateLendingMarketInstruction(
        {
          signer: admin,
          lendingMarket: market.address,
          instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
          mode: BigInt(setting.mode),
          value: paddedTo('', 72).map((zero, index) => setting.value[index] ?? zero),
        },
        { programAddress: lending },
      ),
    ]);
    reportSignature(`market ${setting.what}`, signature);
  }

  return market.address;
}

async function adminTokenAccount(
  cluster: Cluster,
  admin: KeyPairSigner,
  token: SandboxToken,
  mint: Address,
  amount: bigint,
): Promise<Address> {
  const tokenProgram = tokenProgramAddress(token);
  const [account] = await findAssociatedTokenPda({
    owner: admin.address,
    mint,
    tokenProgram,
  });
  const instructions: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: admin,
      ata: account,
      owner: admin.address,
      mint,
      tokenProgram,
    }),
  ];
  if (amount > 0n) {
    instructions.push(
      getMintToInstruction(
        { mint, token: account, mintAuthority: admin, amount },
        { programAddress: tokenProgram },
      ),
    );
  }
  const signature = await sendInstructions(cluster, admin, instructions);
  reportSignature(`${token.symbol} admin account`, signature);
  return account;
}

async function ensureOneReserve(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  globalConfig: Address,
  prices: Address,
  token: SandboxToken,
): Promise<Address> {
  const reserve = await namedSigner(`reserve-${token.symbol.toLowerCase()}`);
  const reserveOwner = await accountOwner(cluster, reserve.address);
  if (reserveOwner !== null && reserveOwner !== lending) {
    throw new Error(
      `${reserve.address} is owned by ${reserveOwner}, not by ${lending}. Move its keypair out of the devnet folder so a new reserve is made.`,
    );
  }
  // Every config write states the value it wants rather than changing it by a step, so a run that
  // stopped part way through is finished by running again.
  if (reserveOwner === lending) {
    reportStep(
      `  ${token.symbol.padEnd(6)} reserve      ${reserve.address}  already there`,
    );
    await writeTheReserveConfig(
      cluster,
      admin,
      lending,
      market,
      globalConfig,
      prices,
      token,
      reserve.address,
    );
    return reserve.address;
  }

  const mint = (await namedSigner(mintKeypairName(token))).address;
  const marketAuthority = await derive(lending, [seedOf('lma'), addressSeed(market)]);
  const pdas = await reservePdas(lending, reserve.address);
  const tokenProgram = tokenProgramAddress(token);
  const seedAmount = token.symbol === 'USDC' ? USDC_LIQUIDITY_TO_SEED : 10;
  const source = await adminTokenAccount(
    cluster,
    admin,
    token,
    mint,
    wholeUnits(token, seedAmount),
  );

  const lamports = await cluster.rpc
    .getMinimumBalanceForRentExemption(RESERVE_ACCOUNT_LENGTH)
    .send();
  const created = await sendInstructions(
    cluster,
    admin,
    [
      getCreateAccountInstruction({
        payer: admin,
        newAccount: reserve,
        lamports,
        space: RESERVE_ACCOUNT_LENGTH,
        programAddress: lending,
      }),
      getInitReserveInstruction(
        {
          signer: admin,
          lendingMarket: market,
          lendingMarketAuthority: marketAuthority,
          reserve: reserve.address,
          reserveLiquidityMint: mint,
          reserveLiquiditySupply: pdas.liquiditySupply,
          feeReceiver: pdas.feeReceiver,
          reserveCollateralMint: pdas.collateralMint,
          reserveCollateralSupply: pdas.collateralSupply,
          initialLiquiditySource: source,
          rent: RENT_SYSVAR_ADDRESS,
          liquidityTokenProgram: tokenProgram,
          collateralTokenProgram: TOKEN_PROGRAM_ADDRESS,
          systemProgram: SYSTEM_PROGRAM_ADDRESS,
          instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
        },
        { programAddress: lending },
      ),
    ],
    { extraSigners: [reserve], computeUnitLimit: 400_000 },
  );
  reportStep(`  ${token.symbol.padEnd(6)} reserve      ${reserve.address}`);
  reportSignature(`${token.symbol} reserve created`, created);

  await writeTheReserveConfig(
    cluster,
    admin,
    lending,
    market,
    globalConfig,
    prices,
    token,
    reserve.address,
  );
  return reserve.address;
}

async function writeTheReserveConfig(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  globalConfig: Address,
  prices: Address,
  token: SandboxToken,
  reserveAddress: Address,
): Promise<void> {
  const template = readTemplateReserve(token.templateReserve);
  // A reserve may only take a write that skips validation while both of its limits are zero. Once
  // it is open every write is validated in full, which a finished config passes.
  const stillClosed = await theReserveIsStillClosed(cluster, reserveAddress);
  const writes = reserveConfigWrites(token, template, prices);
  for (let at = 0; at < writes.length; at += WRITES_PER_TRANSACTION) {
    const batch = writes.slice(at, at + WRITES_PER_TRANSACTION);
    const signature = await sendInstructions(
      cluster,
      admin,
      batch.map((write) =>
        getUpdateReserveConfigInstruction(
          {
            signer: admin,
            globalConfig,
            lendingMarket: market,
            reserve: reserveAddress,
            instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
            mode: write.mode,
            value: write.value,
            skipConfigIntegrityValidation: stillClosed,
          },
          { programAddress: lending },
        ),
      ),
      { computeUnitLimit: 400_000 },
    );
    reportSignature(
      `${token.symbol} config: ${batch.map((write) => write.what).join(', ')}`,
      signature,
    );
  }

  for (const write of reserveOpeningWrites()) {
    const signature = await sendInstructions(
      cluster,
      admin,
      [
        getUpdateReserveConfigInstruction(
          {
            signer: admin,
            globalConfig,
            lendingMarket: market,
            reserve: reserveAddress,
            instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
            mode: write.mode,
            value: write.value,
            skipConfigIntegrityValidation: false,
          },
          { programAddress: lending },
        ),
      ],
      { computeUnitLimit: 400_000 },
    );
    reportSignature(`${token.symbol} ${write.what}`, signature);
  }
}

const RESERVE_DEPOSIT_LIMIT_OFFSET = 5_016;
const RESERVE_BORROW_LIMIT_OFFSET = 5_024;

async function theReserveIsStillClosed(
  cluster: Cluster,
  reserveAddress: Address,
): Promise<boolean> {
  const data = await accountData(cluster, reserveAddress);
  if (data === null) {
    return true;
  }
  const limitAt = (offset: number): bigint => {
    let value = 0n;
    for (let index = 7; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(data[offset + index] ?? 0);
    }
    return value;
  };
  return (
    limitAt(RESERVE_DEPOSIT_LIMIT_OFFSET) === 0n &&
    limitAt(RESERVE_BORROW_LIMIT_OFFSET) === 0n
  );
}

async function seedTheUsdcReserve(
  cluster: Cluster,
  admin: KeyPairSigner,
  lending: Address,
  market: Address,
  usdcReserve: Address,
): Promise<void> {
  const token = SANDBOX_TOKENS.find((entry) => entry.symbol === 'USDC');
  if (token === undefined) {
    throw new Error('USDC is missing from the sandbox token list');
  }
  const mint = (await namedSigner(mintKeypairName(token))).address;
  const marketAuthority = await derive(lending, [seedOf('lma'), addressSeed(market)]);
  const pdas = await reservePdas(lending, usdcReserve);
  const amount = wholeUnits(token, USDC_LIQUIDITY_TO_SEED);

  const source = await adminTokenAccount(cluster, admin, token, mint, amount);
  const [collateralAccount] = await findAssociatedTokenPda({
    owner: admin.address,
    mint: pdas.collateralMint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const signature = await sendInstructions(
    cluster,
    admin,
    [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: admin,
        ata: collateralAccount,
        owner: admin.address,
        mint: pdas.collateralMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
      getDepositReserveLiquidityInstruction(
        {
          owner: admin,
          reserve: usdcReserve,
          lendingMarket: market,
          lendingMarketAuthority: marketAuthority,
          reserveLiquidityMint: mint,
          reserveLiquiditySupply: pdas.liquiditySupply,
          reserveCollateralMint: pdas.collateralMint,
          userSourceLiquidity: source,
          userDestinationCollateral: collateralAccount,
          collateralTokenProgram: TOKEN_PROGRAM_ADDRESS,
          liquidityTokenProgram: tokenProgramAddress(token),
          instructionSysvarAccount: INSTRUCTIONS_SYSVAR_ADDRESS,
          liquidityAmount: amount,
        },
        { programAddress: lending },
      ),
    ],
    { computeUnitLimit: 400_000 },
  );
  reportSignature(`${USDC_LIQUIDITY_TO_SEED} USDC deposited as liquidity`, signature);
}

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const admin = await adminSigner();
  const registry = readRegistry();
  const lending = (await namedSigner('klend')).address;
  const prices = registry.prices as Address | undefined;
  if (prices === undefined) {
    throw new Error(
      'Run pnpm devnet:prices first so the reserves have an oracle to point at.',
    );
  }

  reportStep(`lending program     ${lending}`);
  reportStep(`oracle              ${prices}`);

  const globalConfig = await ensureTheGlobalConfigExists(cluster, admin, lending);
  const market = await ensureTheMarketExists(cluster, admin, lending);

  const reserves: Record<string, string> = {};
  for (const token of SANDBOX_TOKENS) {
    reserves[token.symbol] = await ensureOneReserve(
      cluster,
      admin,
      lending,
      market,
      globalConfig,
      prices,
      token,
    );
  }

  const usdcReserve = reserves['USDC'] as Address | undefined;
  if (usdcReserve !== undefined) {
    await seedTheUsdcReserve(cluster, admin, lending, market, usdcReserve);
  }

  const usdc = SANDBOX_TOKENS.find((entry) => entry.symbol === 'USDC');
  const treasury =
    usdc === undefined
      ? undefined
      : await adminTokenAccount(
          cluster,
          admin,
          usdc,
          (await namedSigner(mintKeypairName(usdc))).address,
          0n,
        );

  mergeIntoRegistry({
    market,
    reserves,
    admin: admin.address,
    ...(treasury === undefined ? {} : { treasury }),
  });

  reportStep('');
  reportStep('the sandbox lending market');
  reportStep(`  market   ${market}`);
  reportStep(`           ${explorerAddressLink(market)}`);
  for (const token of SANDBOX_TOKENS) {
    reportStep(`  ${token.symbol.padEnd(6)}   ${reserves[token.symbol] ?? '—'}`);
  }
  reportStep(`  treasury ${treasury ?? '—'}`);
}

await main();
