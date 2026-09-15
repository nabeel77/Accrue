import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from '@solana/kit';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const fixturesDirectory = resolve(repositoryRoot, 'tests/fixtures/accounts');

const ACCRUE_PROGRAM = '6KUwCyECUrvjppwAe92FxTqHLvw2LKGmfkV7j37r6gBb';
const KAMINO_LEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
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

const RESERVE_OFFSETS = {
  liquiditySupplyVault: 160,
  liquidityFeeVault: 192,
  collateralMint: 2560,
  collateralSupplyVault: 2600,
} as const;

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

function readReserveField(label: string, offset: number): string {
  const fixture = JSON.parse(
    readFileSync(resolve(fixturesDirectory, `${label}.json`), 'utf8'),
  ) as { data_base64: string };
  const bytes = Buffer.from(fixture.data_base64, 'base64');
  return encodeBase58(bytes.subarray(offset, offset + 32));
}

const addressEncoder = getAddressEncoder();

async function derive(
  seeds: (string | Address)[],
  programAddress: string,
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: address(programAddress),
    seeds: seeds.map((seed) =>
      typeof seed === 'string' &&
      seed.length < 33 &&
      !/^[1-9A-HJ-NP-Za-km-z]{32,}$/.exec(seed)
        ? new TextEncoder().encode(seed)
        : addressEncoder.encode(address(seed)),
    ),
  });
  return derived;
}

async function associatedTokenAddress(
  owner: Address,
  mint: string,
  tokenProgram: string,
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(address(tokenProgram)),
      addressEncoder.encode(address(mint)),
    ],
  });
  return derived;
}

async function main(): Promise<void> {
  const position = await derive(
    ['position', OWNER, NVDAX_MINT, ONYC_MINT],
    ACCRUE_PROGRAM,
  );
  const config = await derive(['config'], ACCRUE_PROGRAM);

  const [obligationAddress] = await getProgramDerivedAddress({
    programAddress: address(KAMINO_LEND),
    seeds: [
      new Uint8Array([0]),
      new Uint8Array([0]),
      addressEncoder.encode(position),
      addressEncoder.encode(address(MARKET)),
      addressEncoder.encode(address(SYSTEM_PROGRAM)),
      addressEncoder.encode(address(SYSTEM_PROGRAM)),
    ],
  });
  const [userMetadata] = await getProgramDerivedAddress({
    programAddress: address(KAMINO_LEND),
    seeds: [new TextEncoder().encode('user_meta'), addressEncoder.encode(position)],
  });
  const [marketAuthority] = await getProgramDerivedAddress({
    programAddress: address(KAMINO_LEND),
    seeds: [new TextEncoder().encode('lma'), addressEncoder.encode(address(MARKET))],
  });

  const ourAccounts: Record<string, string> = {
    owner: OWNER,
    config,
    position,
    obligation: obligationAddress,
    user_metadata: userMetadata,
    lending_market: MARKET,
    lending_market_authority: marketAuthority,
    scope_prices: SCOPE_PRICES,

    collateral_reserve: '7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q',
    collateral_mint: NVDAX_MINT,
    collateral_liquidity_supply: readReserveField(
      'reserve_nvdax',
      RESERVE_OFFSETS.liquiditySupplyVault,
    ),
    collateral_ctoken_mint: readReserveField(
      'reserve_nvdax',
      RESERVE_OFFSETS.collateralMint,
    ),
    collateral_ctoken_vault: readReserveField(
      'reserve_nvdax',
      RESERVE_OFFSETS.collateralSupplyVault,
    ),

    borrow_reserve: '97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E',
    borrow_mint: USDC_MINT,
    borrow_liquidity_supply: readReserveField(
      'reserve_usdc',
      RESERVE_OFFSETS.liquiditySupplyVault,
    ),
    borrow_fee_receiver: readReserveField(
      'reserve_usdc',
      RESERVE_OFFSETS.liquidityFeeVault,
    ),

    owner_collateral_ata: await associatedTokenAddress(
      address(OWNER),
      NVDAX_MINT,
      TOKEN_2022_PROGRAM,
    ),
    position_collateral_ata: await associatedTokenAddress(
      position,
      NVDAX_MINT,
      TOKEN_2022_PROGRAM,
    ),
    position_usdc_ata: await associatedTokenAddress(position, USDC_MINT, TOKEN_PROGRAM),
    position_destination_ata: await associatedTokenAddress(
      position,
      ONYC_MINT,
      TOKEN_PROGRAM,
    ),
    destination_mint: ONYC_MINT,

    accrue_program: ACCRUE_PROGRAM,
    kamino_program: KAMINO_LEND,
    token_program: TOKEN_PROGRAM,
    token_2022_program: TOKEN_2022_PROGRAM,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM,
    system_program: SYSTEM_PROGRAM,
    rent_sysvar: RENT_SYSVAR,
    instructions_sysvar: INSTRUCTIONS_SYSVAR,
  };

  const quoteResponse = await (
    await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${ONYC_MINT}` +
        `&amount=400000000&slippageBps=50&restrictIntermediateTokens=true&maxAccounts=28`,
    )
  ).json();

  const swapResponse = (await (
    await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: position,
        wrapAndUnwrapSol: false,
        useSharedAccounts: false,
        skipUserAccountsRpcCalls: true,
      }),
    })
  ).json()) as {
    swapInstruction: {
      programId: string;
      accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
      data: string;
    };
  };

  const routeAddresses = new Set<string>(
    swapResponse.swapInstruction.accounts.map((account) => account.pubkey),
  );
  routeAddresses.add(swapResponse.swapInstruction.programId);

  const ourUnique = new Set(Object.values(ourAccounts));
  const union = new Set([...ourUnique, ...routeAddresses]);
  const routeOnly = [...routeAddresses].filter((candidate) => !ourUnique.has(candidate));

  const swapDataBytes = Buffer.from(swapResponse.swapInstruction.data, 'base64').length;
  const accrueDataBytes = 8 + 8 + 8 + 8 + 7 + 1;
  const accountIndexBytes = union.size + routeAddresses.size;
  const signatureBytes = 64 + 1;
  const headerBytes = 3 + 1 + 32 + 1 + 2 + 8;
  const messageBytes =
    headerBytes +
    union.size * 32 +
    accountIndexBytes +
    accrueDataBytes +
    swapDataBytes +
    8;

  console.log('our own accounts, unique:      ', ourUnique.size);
  console.log('jupiter route accounts, unique:', routeAddresses.size);
  console.log('route addresses not already ours:', routeOnly.length);
  console.log('UNION, unique addresses:       ', union.size, '/ 64 allowed');
  console.log(
    'estimated version 1 size:      ',
    signatureBytes + messageBytes,
    '/ 4096 allowed',
  );
  console.log('  jupiter instruction data:    ', swapDataBytes, 'bytes');
  console.log('\nroute addresses that are new to the transaction:');
  for (const candidate of routeOnly) console.log('  ', candidate);
}

await main();
