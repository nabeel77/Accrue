import {
  appendTransactionMessageInstructions,
  compileTransaction,
  compileTransactionMessage,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  fetchAddressesForLookupTables,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';

import {
  MAX_TRANSACTION_SIZE_BYTES,
  MAX_UNIQUE_ADDRESSES_PER_TRANSACTION,
  MAX_LEGACY_TRANSACTION_SIZE_BYTES,
} from '../transactionVersion.js';

const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;
const A_PROBE_TRANSACTION_SIZE = 1_400;
const BASE64_CHARACTERS_PER_THREE_BYTES = 4;

// The rescue page runs this in a browser, where there is no Buffer to measure with.
function bytesOfBase64(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / BASE64_CHARACTERS_PER_THREE_BYTES) * 3 - padding;
}

function base64OfZeroes(length: number): string {
  let binary = '';
  for (let index = 0; index < length; index += 1) {
    binary += '\u0000';
  }
  return btoa(binary);
}

export interface CompileOptions {
  readonly rpc: Rpc<SolanaRpcApi>;
  readonly feePayer: Address;
  readonly computeUnitLimit: number;
  readonly priorityFeeLamports: bigint;
  // The cluster's own table, plus any the router named for this route.
  readonly lookupTables?: readonly Address[];
  // Whether the wallet that will sign says it can read a version one transaction. A wallet that
  // does not cannot be handed one: it fails inside the wallet, before anyone sees what it is.
  // Nothing signs here without a wallet except the keeper, which is why this defaults to true.
  readonly walletTakesVersionOne?: boolean;
}

export interface CompiledTransaction {
  readonly wire: Base64EncodedWireTransaction;
  readonly version: 0 | 1;
  readonly bytes: number;
  readonly uniqueAddresses: number;
  readonly blockhashExpiresAtHeight: bigint;
  readonly usedLookupTables: boolean;
}

let theEndpointTakesFourKilobytes: Promise<boolean> | null = null;

// Asked once for the life of the process.
export function endpointAcceptsVersionOne(rpc: Rpc<SolanaRpcApi>): Promise<boolean> {
  theEndpointTakesFourKilobytes ??= (async (): Promise<boolean> => {
    const filler = base64OfZeroes(A_PROBE_TRANSACTION_SIZE);
    try {
      await rpc
        .simulateTransaction(filler as Base64EncodedWireTransaction, {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
        })
        .send();
      return true;
    } catch (failure) {
      return !(failure instanceof Error && failure.message.includes('too large'));
    }
  })();
  return theEndpointTakesFourKilobytes;
}

export function forgetWhatTheEndpointAccepts(): void {
  theEndpointTakesFourKilobytes = null;
}

interface Lifetime {
  readonly blockhash: Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0];
}

async function theLatestBlockhash(options: CompileOptions): Promise<Lifetime> {
  const { value } = await options.rpc.getLatestBlockhash().send();
  return { blockhash: value };
}

function measured(
  wire: Base64EncodedWireTransaction,
  version: 0 | 1,
  uniqueAddresses: number,
  lifetime: Lifetime,
  usedLookupTables: boolean,
): CompiledTransaction {
  return {
    wire,
    version,
    bytes: bytesOfBase64(wire),
    uniqueAddresses,
    blockhashExpiresAtHeight: lifetime.blockhash.lastValidBlockHeight,
    usedLookupTables,
  };
}

function compileVersionOne(
  options: CompileOptions,
  instructions: readonly Instruction[],
  lifetime: Lifetime,
): CompiledTransaction {
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (draft) => setTransactionMessageFeePayer(options.feePayer, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(lifetime.blockhash, draft),
    (draft) => setTransactionMessageComputeUnitLimit(options.computeUnitLimit, draft),
    (draft) =>
      setTransactionMessagePriorityFeeLamports(options.priorityFeeLamports, draft),
    (draft) =>
      setTransactionMessageLoadedAccountsDataSizeLimit(
        LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
        draft,
      ),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
  );
  return measured(
    getBase64EncodedWireTransaction(compileTransaction(message)),
    1,
    compileTransactionMessage(message).staticAccounts.length,
    lifetime,
    false,
  );
}

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111' as Address;
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;
const SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 4;
const MICRO_LAMPORTS_IN_A_LAMPORT = 1_000_000n;

function computeBudgetInstruction(discriminator: number, value: bigint): Instruction {
  const width = discriminator === SET_COMPUTE_UNIT_PRICE ? 8 : 4;
  const data = new Uint8Array(1 + width);
  data[0] = discriminator;
  for (let index = 0; index < width; index += 1) {
    data[1 + index] = Number((value >> BigInt(index * 8)) & 0xffn);
  }
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
}

// Version 0 has no header for these, so the same three settings go in as instructions.
function theBudgetAsInstructions(options: CompileOptions): Instruction[] {
  const perComputeUnit =
    (options.priorityFeeLamports * MICRO_LAMPORTS_IN_A_LAMPORT) /
    BigInt(Math.max(options.computeUnitLimit, 1));
  return [
    computeBudgetInstruction(SET_COMPUTE_UNIT_LIMIT, BigInt(options.computeUnitLimit)),
    computeBudgetInstruction(SET_COMPUTE_UNIT_PRICE, perComputeUnit),
    computeBudgetInstruction(
      SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
      BigInt(LOADED_ACCOUNTS_DATA_SIZE_LIMIT),
    ),
  ];
}

async function compileVersionZero(
  options: CompileOptions,
  instructions: readonly Instruction[],
  lifetime: Lifetime,
  tables: readonly Address[],
): Promise<CompiledTransaction> {
  const plain = pipe(
    createTransactionMessage({ version: 0 }),
    (one) => setTransactionMessageFeePayer(options.feePayer, one),
    (one) => setTransactionMessageLifetimeUsingBlockhash(lifetime.blockhash, one),
    (one) =>
      appendTransactionMessageInstructions(
        [...theBudgetAsInstructions(options), ...instructions],
        one,
      ),
  );
  // A small transaction needs no table, and a cluster may have none to offer.
  const message =
    tables.length === 0
      ? plain
      : compressTransactionMessageUsingAddressLookupTables(
          plain,
          await fetchAddressesForLookupTables([...tables], options.rpc),
        );
  return measured(
    getBase64EncodedWireTransaction(compileTransaction(message)),
    0,
    compileTransactionMessage(message).staticAccounts.length,
    lifetime,
    true,
  );
}

export class NothingFits extends Error {
  constructor(readonly bytes: number) {
    super(`a transaction of ${bytes} bytes fits no format this endpoint takes`);
    this.name = 'NothingFits';
  }
}

export async function compileTheFirstThatFits(
  options: CompileOptions,
  instructions: readonly Instruction[],
): Promise<CompiledTransaction> {
  const tables = options.lookupTables ?? [];
  const lifetime = await theLatestBlockhash(options);
  const versionOne = compileVersionOne(options, instructions, lifetime);

  // A wallet that cannot read version one gets version zero, with the tables when there are any
  // and without when the instruction is small enough not to need them.
  if (options.walletTakesVersionOne === false) {
    const versionZero = await compileVersionZero(options, instructions, lifetime, tables);
    if (versionZero.bytes <= MAX_LEGACY_TRANSACTION_SIZE_BYTES) {
      return versionZero;
    }
    throw new NothingFits(versionZero.bytes);
  }

  const roomy = await endpointAcceptsVersionOne(options.rpc);
  const fitsVersionOne =
    versionOne.bytes <= MAX_TRANSACTION_SIZE_BYTES &&
    versionOne.uniqueAddresses <= MAX_UNIQUE_ADDRESSES_PER_TRANSACTION;
  if (roomy && fitsVersionOne) {
    return versionOne;
  }
  if (versionOne.bytes <= MAX_LEGACY_TRANSACTION_SIZE_BYTES) {
    return versionOne;
  }

  const versionZero = await compileVersionZero(options, instructions, lifetime, tables);
  if (versionZero.bytes <= MAX_LEGACY_TRANSACTION_SIZE_BYTES) {
    return versionZero;
  }
  throw new NothingFits(versionOne.bytes);
}
