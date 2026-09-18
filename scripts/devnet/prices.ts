import { createHash } from 'node:crypto';

import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';

import {
  accountExists,
  adminSigner,
  connectToDevnet,
  explorerAddressLink,
  mergeIntoRegistry,
  namedSigner,
  readRegistry,
  reportServiceSignature,
  reportSignature,
  reportStep,
  sendInstructions,
  type Cluster,
} from './shared.js';
import { currentPrices, savePrices, startingPrices } from './priceBook.js';
import { setThePoolRates } from './router.js';
import { SANDBOX_TOKENS, scopeValueFor, tokenBySymbol } from './tokens.js';

const ORACLE_PRICES_ACCOUNT_LENGTH = 28_712n;
const PRICE_ADMIN_SEED = 'admin';
const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111' as Address;

function anchorDiscriminator(name: string): Uint8Array {
  return Uint8Array.from(
    createHash('sha256').update(`global:${name}`).digest().subarray(0, 8),
  );
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

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

async function priceAdminAddress(
  programAddress: Address,
  prices: Address,
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress,
    seeds: [
      new TextEncoder().encode(PRICE_ADMIN_SEED),
      new Uint8Array(getAddressEncoder().encode(prices)),
    ],
  });
  return derived;
}

function createAccountInstruction(
  payer: Address,
  newAccount: Address,
  lamports: bigint,
  space: bigint,
  owner: Address,
): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: newAccount, role: AccountRole.WRITABLE_SIGNER },
    ],
    data: concat([
      unsigned(0n, 4),
      unsigned(lamports, 8),
      unsigned(space, 8),
      new Uint8Array(getAddressEncoder().encode(owner)),
    ]),
  };
}

function initializeInstruction(
  programAddress: Address,
  admin: Address,
  prices: Address,
  pricesAdmin: Address,
): Instruction {
  return {
    programAddress,
    accounts: [
      { address: admin, role: AccountRole.WRITABLE_SIGNER },
      { address: prices, role: AccountRole.WRITABLE },
      { address: pricesAdmin, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: anchorDiscriminator('initialize'),
  };
}

interface FeedWrite {
  readonly feedIndex: number;
  readonly value: bigint;
  readonly exponent: bigint;
}

function setPricesInstruction(
  programAddress: Address,
  admin: Address,
  prices: Address,
  pricesAdmin: Address,
  writes: readonly FeedWrite[],
): Instruction {
  const body = writes.map((write) =>
    concat([
      unsigned(BigInt(write.feedIndex), 2),
      unsigned(write.value, 8),
      unsigned(write.exponent, 8),
    ]),
  );
  return {
    programAddress,
    accounts: [
      { address: admin, role: AccountRole.READONLY_SIGNER },
      { address: prices, role: AccountRole.WRITABLE },
      { address: pricesAdmin, role: AccountRole.READONLY },
    ],
    data: concat([
      anchorDiscriminator('set_prices'),
      unsigned(BigInt(writes.length), 4),
      ...body,
    ]),
  };
}

export async function ensureThePricesAccountExists(
  cluster: Cluster,
  admin: KeyPairSigner,
  programAddress: Address,
): Promise<Address> {
  const registry = readRegistry();
  const prices = await namedSigner('prices');
  const pricesAdmin = await priceAdminAddress(programAddress, prices.address);

  if (
    registry.prices === prices.address &&
    (await accountExists(cluster, prices.address))
  ) {
    return prices.address;
  }

  if (!(await accountExists(cluster, prices.address))) {
    const rent = await cluster.rpc
      .getMinimumBalanceForRentExemption(ORACLE_PRICES_ACCOUNT_LENGTH)
      .send();
    const signature = await sendInstructions(
      cluster,
      admin,
      [
        createAccountInstruction(
          admin.address,
          prices.address,
          rent,
          ORACLE_PRICES_ACCOUNT_LENGTH,
          programAddress,
        ),
        initializeInstruction(programAddress, admin.address, prices.address, pricesAdmin),
      ],
      { extraSigners: [prices] },
    );
    reportSignature('prices account created', signature);
  } else if (!(await accountExists(cluster, pricesAdmin))) {
    const signature = await sendInstructions(cluster, admin, [
      initializeInstruction(programAddress, admin.address, prices.address, pricesAdmin),
    ]);
    reportSignature('prices account initialised', signature);
  }

  mergeIntoRegistry({ prices: prices.address });
  return prices.address;
}

export async function writeEveryPrice(
  cluster: Cluster,
  admin: KeyPairSigner,
  programAddress: Address,
  prices: Address,
  values: Record<string, number>,
): Promise<string> {
  const pricesAdmin = await priceAdminAddress(programAddress, prices);
  const writes = SANDBOX_TOKENS.map((token) => ({
    feedIndex: token.feedIndex,
    value: scopeValueFor(token, values[token.symbol] ?? token.startingPrice),
    exponent: BigInt(token.priceExponent),
  }));
  return sendInstructions(
    cluster,
    admin,
    [setPricesInstruction(programAddress, admin.address, prices, pricesAdmin, writes)],
    { computeUnitLimit: 60_000 },
  );
}

function argument(name: string): string | undefined {
  const flag = `--${name}`;
  const joined = process.argv.find((given) => given.startsWith(`${flag}=`));
  if (joined !== undefined) {
    return joined.slice(flag.length + 1);
  }
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}

function applyTheMove(values: Record<string, number>): Record<string, number> {
  const move = argument('move');
  if (move === undefined) {
    return values;
  }
  const [symbol, percentText] = move.split('=');
  if (symbol === undefined || percentText === undefined) {
    throw new Error('--move takes SYMBOL=PERCENT, for example --move NVDAx=-20');
  }
  const token = tokenBySymbol(symbol);
  const percent = Number(percentText);
  if (!Number.isFinite(percent)) {
    throw new Error(`${percentText} is not a percentage`);
  }
  const before = values[token.symbol] ?? token.startingPrice;
  const after = before * (1 + percent / 100);
  reportStep(
    `  moving ${token.symbol} ${percent > 0 ? '+' : ''}${percent}%: ${before} to ${after}`,
  );
  return { ...values, [token.symbol]: after };
}

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const admin = await adminSigner();
  const priceFeed = await namedSigner('price-feed');

  reportStep(`price feed program  ${priceFeed.address}`);
  const prices = await ensureThePricesAccountExists(cluster, admin, priceFeed.address);
  reportStep(`prices account      ${prices}`);
  reportStep(`                    ${explorerAddressLink(prices)}`);

  let values = applyTheMove(currentPrices());
  if (process.argv.includes('--reset')) {
    values = startingPrices();
  }
  savePrices(values);

  const written = currentPrices();
  const signature = await writeEveryPrice(
    cluster,
    admin,
    priceFeed.address,
    prices,
    written,
  );
  const shown = SANDBOX_TOKENS.map(
    (token) => `${token.symbol} ${written[token.symbol]?.toFixed(4) ?? '—'}`,
  ).join('  ');
  reportStep(`${new Date().toISOString()}  ${shown}`);
  reportServiceSignature('prices written', signature);

  const rates = await setThePoolRates(
    cluster,
    admin,
    (await namedSigner('honest-swap')).address,
    written,
  );
  if (rates !== undefined) {
    reportServiceSignature('router rates written', rates);
  }
}

if (process.argv[1]?.endsWith('prices.ts') === true) {
  await main();
}
