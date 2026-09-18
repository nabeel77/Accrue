import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  AccountRole,
  type Address,
  type Instruction,
} from '@solana/kit';

import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  currentCluster,
  INSTRUCTIONS_SYSVAR_ADDRESS,
  JUPITER_V6_PROGRAM_ADDRESS,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  KAMINO_LENDING_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  findSandboxSwapAuthority,
} from '@accrue/solana';
import {
  findLendingMarketAuthority,
  readReserve,
  reserveAccounts,
} from '@accrue/solana/kamino';
import { ACCRUE_PROGRAM_ADDRESS, findConfigPda } from '@accrue/solana/program';

import {
  adminSigner,
  connectToDevnet,
  mergeIntoRegistry,
  reportSignature,
  reportStep,
  sendInstructions,
} from '../devnet/shared.js';

const LOOKUP_TABLE_PROGRAM = address('AddressLookupTab1e1111111111111111111111111');
const CREATE_LOOKUP_TABLE = 0;
const EXTEND_LOOKUP_TABLE = 2;
const ADDRESSES_PER_EXTEND = 20;
const RECENT_SLOT_LAG = 1n;

const addresses = getAddressEncoder();
const unsigned64 = getU64Encoder();

function littleEndian32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

async function lookupTableAddress(
  authority: Address,
  recentSlot: bigint,
): Promise<{ table: Address; bump: number }> {
  const [table, bump] = await getProgramDerivedAddress({
    programAddress: LOOKUP_TABLE_PROGRAM,
    seeds: [
      new Uint8Array(addresses.encode(authority)),
      new Uint8Array(unsigned64.encode(recentSlot)),
    ],
  });
  return { table, bump };
}

function createInstruction(input: {
  readonly table: Address;
  readonly authority: Address;
  readonly payer: Address;
  readonly recentSlot: bigint;
  readonly bump: number;
}): Instruction {
  return {
    programAddress: LOOKUP_TABLE_PROGRAM,
    accounts: [
      { address: input.table, role: AccountRole.WRITABLE },
      { address: input.authority, role: AccountRole.READONLY_SIGNER },
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([
      ...littleEndian32(CREATE_LOOKUP_TABLE),
      ...unsigned64.encode(input.recentSlot),
      input.bump,
    ]),
  };
}

function extendInstruction(input: {
  readonly table: Address;
  readonly authority: Address;
  readonly payer: Address;
  readonly added: readonly Address[];
}): Instruction {
  return {
    programAddress: LOOKUP_TABLE_PROGRAM,
    accounts: [
      { address: input.table, role: AccountRole.WRITABLE },
      { address: input.authority, role: AccountRole.READONLY_SIGNER },
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([
      ...littleEndian32(EXTEND_LOOKUP_TABLE),
      ...unsigned64.encode(BigInt(input.added.length)),
      ...input.added.flatMap((one) => [...addresses.encode(one)]),
    ]),
  };
}

// Everything an open, a protect, a grow or an unwind names that is the same for every position.
async function everythingTheClusterShares(): Promise<Address[]> {
  const cluster = currentCluster();
  const [config] = await findConfigPda();
  const shared: Address[] = [
    ACCRUE_PROGRAM_ADDRESS,
    config,
    KAMINO_LENDING_PROGRAM_ADDRESS,
    KAMINO_FARMS_PROGRAM_ADDRESS,
    JUPITER_V6_PROGRAM_ADDRESS,
    cluster.scopeProgram,
    cluster.scopePriceAccount,
    cluster.lendingMarket,
    await findLendingMarketAuthority(cluster.lendingMarket),
    SYSTEM_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
    TOKEN_2022_PROGRAM_ADDRESS,
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    INSTRUCTIONS_SYSVAR_ADDRESS,
    await findSandboxSwapAuthority(JUPITER_V6_PROGRAM_ADDRESS),
  ];

  const connection = connectToDevnet();
  const now = BigInt(Math.floor(Date.now() / 1_000));
  for (const reserve of Object.values(cluster.reserves)) {
    shared.push(reserve);
    const reading = await readReserve(connection.rpc, reserve, now);
    const vaults = reserveAccounts(reading.snapshot);
    shared.push(
      vaults.liquiditySupply,
      vaults.liquidityFeeReceiver,
      vaults.collateralMint,
      vaults.collateralSupply,
    );
  }
  for (const mint of Object.values(cluster.mints)) {
    shared.push(mint);
  }

  const seen = new Set<string>();
  return shared.filter((one) => {
    if (seen.has(one)) {
      return false;
    }
    seen.add(one);
    return true;
  });
}

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const admin = await adminSigner();
  const slot = await cluster.rpc.getSlot().send();
  const recentSlot = slot - RECENT_SLOT_LAG;
  const { table, bump } = await lookupTableAddress(admin.address, recentSlot);

  reportStep(`lookup table ${table} for ${currentCluster().name}`);
  const created = await sendInstructions(cluster, admin, [
    createInstruction({
      table,
      authority: admin.address,
      payer: admin.address,
      recentSlot,
      bump,
    }),
  ]);
  reportSignature('lookup table created', created);

  const shared = await everythingTheClusterShares();
  for (let at = 0; at < shared.length; at += ADDRESSES_PER_EXTEND) {
    const added = shared.slice(at, at + ADDRESSES_PER_EXTEND);
    const signature = await sendInstructions(cluster, admin, [
      extendInstruction({ table, authority: admin.address, payer: admin.address, added }),
    ]);
    reportSignature(`added ${added.length} addresses`, signature);
  }

  mergeIntoRegistry({ lookupTable: table });
  reportStep('');
  reportStep(`${shared.length} addresses are in ${table}`);
  reportStep('run pnpm devnet:clusters to write it into the cluster files');
}

await main();
