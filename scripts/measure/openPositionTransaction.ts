import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  address,
  appendTransactionMessageInstruction,
  compileTransactionMessage,
  createTransactionMessage,
  getAddressEncoder,
  getCompiledTransactionMessageEncoder,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessagePriorityFeeLamports,
  type Address,
  type Instruction,
} from '@solana/kit';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const fixturesDirectory = resolve(repositoryRoot, 'tests/fixtures/accounts');

const ACCRUE_PROGRAM = '6KUwCyECUrvjppwAe92FxTqHLvw2LKGmfkV7j37r6gBb';
const KAMINO_LEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const KAMINO_FARMS = 'FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr';
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const RENT_SYSVAR = 'SysvarRent111111111111111111111111111111111';
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ONYC_MINT = '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5';
const NVDAX_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const MARKET = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua';
const SCOPE_PRICES = '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH';
const NVDAX_RESERVE = '7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q';
const USDC_RESERVE = '97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E';

const RESERVE_OFFSETS = {
  farmDebt: 96,
  liquiditySupplyVault: 160,
  liquidityFeeVault: 192,
  collateralMint: 2560,
  collateralSupplyVault: 2600,
} as const;

const BORROW_AMOUNT = 400_000_000n;
const COLLATERAL_AMOUNT = 470_000_000n;
const MAX_ROUTE_ACCOUNTS = 28;
const PRIORITY_FEE_LAMPORTS = 50_000n;
const COMPUTE_UNIT_LIMIT = 700_000;
const VERSION_ONE_ADDRESS_LIMIT = 64;
const VERSION_ONE_BYTE_LIMIT = 4096;
const SIGNATURE_BYTES = 1 + 64;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(raw: Uint8Array): string {
  let value = 0n;
  for (const byte of raw) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET.charAt(Number(value % 58n)) + encoded;
    value /= 58n;
  }
  let leadingZeros = 0;
  for (const byte of raw) {
    if (byte !== 0) break;
    leadingZeros += 1;
  }
  return '1'.repeat(leadingZeros) + encoded;
}

function readReserveField(label: string, offset: number): Address {
  const fixture = JSON.parse(
    readFileSync(resolve(fixturesDirectory, `${label}.json`), 'utf8'),
  ) as { data_base64: string };
  const bytes = Buffer.from(fixture.data_base64, 'base64');
  return address(encodeBase58(bytes.subarray(offset, offset + 32)));
}

const addressEncoder = getAddressEncoder();

async function derive(
  programAddress: string,
  seeds: (Uint8Array | Address)[],
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: address(programAddress),
    seeds: seeds.map((seed) =>
      seed instanceof Uint8Array ? seed : addressEncoder.encode(seed),
    ),
  });
  return derived;
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function associatedTokenAddress(
  owner: Address,
  mint: string,
  tokenProgram: string,
): Promise<Address> {
  return derive(ASSOCIATED_TOKEN_PROGRAM, [owner, address(tokenProgram), address(mint)]);
}

function anchorDiscriminator(instructionName: string): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update(`global:${instructionName}`).digest().subarray(0, 8),
  );
}

function encodeOpenPositionData(routeData: Uint8Array): Uint8Array {
  const strategy = new Uint8Array(8);
  const strategyView = new DataView(strategy.buffer);
  strategyView.setUint16(0, 4_000, true);
  strategyView.setUint16(2, 5_000, true);
  strategyView.setUint16(4, 3_000, true);
  strategy[6] = 1;
  strategy[7] = 1;

  const amounts = new Uint8Array(24);
  const amountsView = new DataView(amounts.buffer);
  amountsView.setBigUint64(0, COLLATERAL_AMOUNT, true);
  amountsView.setBigUint64(8, BORROW_AMOUNT, true);
  amountsView.setBigUint64(16, 0n, true);

  const routeLength = new Uint8Array(4);
  new DataView(routeLength.buffer).setUint32(0, routeData.length, true);

  return Uint8Array.from([
    ...anchorDiscriminator('open_position'),
    ...amounts,
    ...strategy,
    1,
    ...routeLength,
    ...routeData,
  ]);
}

interface JupiterSwapInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

async function fetchJupiterRoute(
  userPublicKey: Address,
): Promise<JupiterSwapInstruction> {
  const quoteResponse = await (
    await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${ONYC_MINT}` +
        `&amount=${BORROW_AMOUNT}&slippageBps=50&restrictIntermediateTokens=true` +
        `&maxAccounts=${MAX_ROUTE_ACCOUNTS}`,
    )
  ).json();

  const swapResponse = (await (
    await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: false,
        useSharedAccounts: false,
        skipUserAccountsRpcCalls: true,
      }),
    })
  ).json()) as { swapInstruction: JupiterSwapInstruction };

  return swapResponse.swapInstruction;
}

async function main(): Promise<void> {
  const owner = address(OWNER);
  const position = await derive(ACCRUE_PROGRAM, [
    text('position'),
    owner,
    address(NVDAX_MINT),
    address(ONYC_MINT),
  ]);
  const config = await derive(ACCRUE_PROGRAM, [text('config')]);
  const obligation = await derive(KAMINO_LEND, [
    new Uint8Array([0]),
    new Uint8Array([0]),
    position,
    address(MARKET),
    address(SYSTEM_PROGRAM),
    address(SYSTEM_PROGRAM),
  ]);
  const userMetadata = await derive(KAMINO_LEND, [text('user_meta'), position]);
  const marketAuthority = await derive(KAMINO_LEND, [text('lma'), address(MARKET)]);
  const usdcDebtFarm = readReserveField('reserve_usdc', RESERVE_OFFSETS.farmDebt);
  const obligationDebtFarm = await derive(KAMINO_FARMS, [
    text('user'),
    usdcDebtFarm,
    obligation,
  ]);

  const writable = (addressToUse: Address) =>
    ({ address: addressToUse, role: 1 }) as const;
  const readonly = (addressToUse: Address) =>
    ({ address: addressToUse, role: 0 }) as const;
  const writableSigner = (addressToUse: Address) =>
    ({ address: addressToUse, role: 3 }) as const;

  const accrueAccounts = [
    writableSigner(owner),
    readonly(config),
    writable(position),
    readonly(address(NVDAX_MINT)),
    readonly(address(ONYC_MINT)),
    readonly(address(USDC_MINT)),
    writable(await associatedTokenAddress(owner, NVDAX_MINT, TOKEN_2022_PROGRAM)),
    writable(await associatedTokenAddress(position, NVDAX_MINT, TOKEN_2022_PROGRAM)),
    writable(await associatedTokenAddress(position, USDC_MINT, TOKEN_PROGRAM)),
    writable(await associatedTokenAddress(position, ONYC_MINT, TOKEN_PROGRAM)),
    writable(address(MARKET)),
    readonly(marketAuthority),
    writable(obligation),
    writable(userMetadata),
    writable(address(NVDAX_RESERVE)),
    writable(readReserveField('reserve_nvdax', RESERVE_OFFSETS.liquiditySupplyVault)),
    writable(readReserveField('reserve_nvdax', RESERVE_OFFSETS.collateralMint)),
    writable(readReserveField('reserve_nvdax', RESERVE_OFFSETS.collateralSupplyVault)),
    writable(address(USDC_RESERVE)),
    writable(readReserveField('reserve_usdc', RESERVE_OFFSETS.liquiditySupplyVault)),
    writable(readReserveField('reserve_usdc', RESERVE_OFFSETS.liquidityFeeVault)),
    readonly(address(ACCRUE_PROGRAM)),
    readonly(address(ACCRUE_PROGRAM)),
    writable(usdcDebtFarm),
    writable(obligationDebtFarm),
    readonly(address(SCOPE_PRICES)),
    readonly(address(KAMINO_FARMS)),
    readonly(address(JUPITER_V6)),
    readonly(address(KAMINO_LEND)),
    readonly(address(INSTRUCTIONS_SYSVAR)),
    readonly(address(TOKEN_2022_PROGRAM)),
    readonly(address(TOKEN_PROGRAM)),
    readonly(address(TOKEN_PROGRAM)),
    readonly(address(TOKEN_PROGRAM)),
    readonly(address(RENT_SYSVAR)),
    readonly(address(SYSTEM_PROGRAM)),
  ];

  const swapInstruction = await fetchJupiterRoute(position);
  const routeAccounts = swapInstruction.accounts.map((account) =>
    account.isWritable
      ? writable(address(account.pubkey))
      : readonly(address(account.pubkey)),
  );
  const routeData = new Uint8Array(Buffer.from(swapInstruction.data, 'base64'));

  const openPosition: Instruction = {
    programAddress: address(ACCRUE_PROGRAM),
    accounts: [...accrueAccounts, ...routeAccounts],
    data: encodeOpenPositionData(routeData),
  };

  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (draft) => setTransactionMessageFeePayer(owner, draft),
    (draft) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: '11111111111111111111111111111111' as never,
          lastValidBlockHeight: 0n,
        },
        draft,
      ),
    (draft) => setTransactionMessageComputeUnitLimit(COMPUTE_UNIT_LIMIT, draft),
    (draft) => setTransactionMessagePriorityFeeLamports(PRIORITY_FEE_LAMPORTS, draft),
    (draft) => appendTransactionMessageInstruction(openPosition, draft),
  );

  const compiled = compileTransactionMessage(message);
  const encodedMessage = getCompiledTransactionMessageEncoder().encode(compiled);
  const uniqueAddresses = new Set(
    [...accrueAccounts, ...routeAccounts]
      .map((account) => account.address as string)
      .concat(ACCRUE_PROGRAM, OWNER),
  );

  const totalBytes = SIGNATURE_BYTES + encodedMessage.length;

  console.log(`accounts on the instruction:      ${openPosition.accounts?.length}`);
  console.log(`  of which the route contributes: ${routeAccounts.length}`);
  console.log(
    `unique addresses:                 ${uniqueAddresses.size} / ${VERSION_ONE_ADDRESS_LIMIT}`,
  );
  console.log(`jupiter instruction data:         ${routeData.length} bytes`);
  console.log(`compiled version 1 message:       ${encodedMessage.length} bytes`);
  console.log(
    `signed transaction:               ${totalBytes} / ${VERSION_ONE_BYTE_LIMIT} bytes`,
  );
  console.log(
    uniqueAddresses.size <= VERSION_ONE_ADDRESS_LIMIT &&
      totalBytes <= VERSION_ONE_BYTE_LIMIT
      ? 'the single transaction path fits'
      : 'the single transaction path does not fit, the split path is needed',
  );
}

await main();
