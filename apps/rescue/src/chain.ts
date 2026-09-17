import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  type Address,
  type Base58EncodedBytes,
  type Base64EncodedWireTransaction,
  type Instruction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from '@solana/kit';

import { DEVNET, MAINNET } from '@accrue/solana/clusters';
import { decodeObligation, decodeReserve } from '@accrue/solana/kamino';
import {
  getClosePositionInstruction,
  getPositionDecoder,
  getRepayInstruction,
  getRescueInstruction,
  type Position,
} from '@accrue/solana/program';

const ACCRUE_PROGRAM = address('6KUwCyECUrvjppwAe92FxTqHLvw2LKGmfkV7j37r6gBb');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');

const LENDING_MARKET_AUTHORITY_SEED = 'lma';
const FARM_USER_STATE_SEED = 'user';
const POSITION_OWNER_OFFSET = 8n;
const COMPUTE_UNIT_LIMIT = 600_000;
const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;
const CREATE_ASSOCIATED_TOKEN_IDEMPOTENT = new Uint8Array([1]);
const USDC_DECIMALS = 6;
const CONFIRMATION_ATTEMPTS = 60;
const A_SECOND = 1_000;
// The program repays the smaller of what is asked for and what is owed, so this asks for all of it.
const REPAY_EVERYTHING = 2n ** 64n - 1n;

const addresses = getAddressEncoder();

export type ClusterChoice = 'devnet' | 'mainnet';

export interface ClusterSetting {
  readonly label: string;
  readonly endpoint: string;
  readonly kaminoLendingProgram: Address;
  readonly kaminoFarmsProgram: Address;
  /** Every reserve of the market, so the collateral one can be found by its mint. */
  readonly reserves: readonly Address[];
}

/** Devnet first, because it is the one anybody can try without risking a real position. */
export const CLUSTERS: Readonly<Record<ClusterChoice, ClusterSetting>> = {
  devnet: {
    label: 'devnet',
    endpoint: 'https://api.devnet.solana.com',
    kaminoLendingProgram: DEVNET.kaminoLendingProgram,
    kaminoFarmsProgram: DEVNET.kaminoFarmsProgram,
    reserves: Object.values(DEVNET.reserves),
  },
  mainnet: {
    label: 'mainnet',
    endpoint: 'https://api.mainnet-beta.solana.com',
    kaminoLendingProgram: MAINNET.kaminoLendingProgram,
    kaminoFarmsProgram: MAINNET.kaminoFarmsProgram,
    reserves: Object.values(MAINNET.reserves),
  },
};

const STATE_NAMES = ['Waiting for the swap', 'Open', 'Closing', 'Closed'] as const;

export interface RescuablePosition {
  readonly address: Address;
  readonly collateralMint: Address;
  readonly destinationMint: Address;
  readonly borrowMint: Address;
  readonly state: string;
}

const decodedPositions = new Map<string, Position>();

interface TokenPrograms {
  readonly collateral: Address;
  readonly borrow: Address;
  readonly destination: Address;
}

export function rpcFor(endpoint: string): Rpc<SolanaRpcApi> {
  return createSolanaRpc(endpoint);
}

function asSeed(value: Address): Uint8Array {
  return new Uint8Array(addresses.encode(value));
}

async function derive(
  programAddress: Address,
  seeds: (Uint8Array | string)[],
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds });
  return derived;
}

function associatedTokenAccount(input: {
  readonly owner: Address;
  readonly mint: Address;
  readonly tokenProgram: Address;
}): Promise<Address> {
  return derive(ASSOCIATED_TOKEN_PROGRAM, [
    asSeed(input.owner),
    asSeed(input.tokenProgram),
    asSeed(input.mint),
  ]);
}

function bytesOf(data: readonly [string, string]): Uint8Array {
  return Uint8Array.from(atob(data[0]), (character) => character.charCodeAt(0));
}

/** Every position this wallet owns, found from the chain alone with no index and no server. */
export async function positionsOwnedBy(
  rpc: Rpc<SolanaRpcApi>,
  owner: Address,
): Promise<RescuablePosition[]> {
  const accounts = await rpc
    .getProgramAccounts(ACCRUE_PROGRAM, {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: POSITION_OWNER_OFFSET,
            bytes: owner as unknown as Base58EncodedBytes,
            encoding: 'base58',
          },
        },
      ],
    })
    .send();

  const found: RescuablePosition[] = [];
  for (const entry of accounts) {
    let decoded: Position;
    try {
      decoded = getPositionDecoder().decode(bytesOf(entry.account.data));
    } catch {
      continue;
    }
    decodedPositions.set(entry.pubkey, decoded);
    found.push({
      address: entry.pubkey,
      collateralMint: decoded.collateralMint,
      destinationMint: decoded.destinationMint,
      borrowMint: decoded.borrowMint,
      state: STATE_NAMES[decoded.state],
    });
  }
  return found;
}

/** A mint's token program is the program that owns its account, never an assumption. */
async function tokenProgramsOf(
  rpc: Rpc<SolanaRpcApi>,
  position: Position,
): Promise<TokenPrograms> {
  const { value } = await rpc
    .getMultipleAccounts(
      [position.collateralMint, position.borrowMint, position.destinationMint],
      { encoding: 'base64' },
    )
    .send();
  return {
    collateral: value[0]?.owner ?? TOKEN_PROGRAM,
    borrow: value[1]?.owner ?? TOKEN_PROGRAM,
    destination: value[2]?.owner ?? TOKEN_PROGRAM,
  };
}

function createAssociatedTokenAccount(input: {
  readonly payer: Address;
  readonly account: Address;
  readonly owner: Address;
  readonly mint: Address;
  readonly tokenProgram: Address;
}): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: input.account, role: AccountRole.WRITABLE },
      { address: input.owner, role: AccountRole.READONLY },
      { address: input.mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: input.tokenProgram, role: AccountRole.READONLY },
    ],
    data: CREATE_ASSOCIATED_TOKEN_IDEMPOTENT,
  };
}

export interface RescuePlan {
  /** Unconditional: this is the one that has to land whatever else is wrong. */
  readonly rescue: Instruction[];
  /**
   * Settling the loan and closing the account, one transaction each. Repaying frees the
   * collateral, a second rescue withdraws it, and only an empty position can be closed.
   */
  readonly settle: Instruction[][];
  readonly stillOwedUsdc: string | null;
}

async function reserveHoldingTheMint(
  rpc: Rpc<SolanaRpcApi>,
  cluster: ClusterSetting,
  mint: Address,
): Promise<Address | null> {
  if (cluster.reserves.length === 0) {
    return null;
  }
  const { value } = await rpc
    .getMultipleAccounts(cluster.reserves, { encoding: 'base64' })
    .send();
  for (const [index, account] of value.entries()) {
    if (account == null) {
      continue;
    }
    try {
      if (decodeReserve(bytesOf(account.data)).liquidityMint === mint) {
        return cluster.reserves[index] ?? null;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Rescue has no conditions: no oracle, no route, no keeper, no config. Everything it needs comes
 * from the position, the obligation and the two reserves, which is why this page can build it.
 */
export async function buildRescue(
  rpc: Rpc<SolanaRpcApi>,
  cluster: ClusterSetting,
  owner: Address,
  position: Address,
): Promise<RescuePlan> {
  const decoded = decodedPositions.get(position);
  if (decoded === undefined) {
    throw new Error('that position was not read from this wallet');
  }

  // The market closes the obligation once nothing is left in it, and a position whose obligation
  // is gone still has to be closable, so the collateral reserve is found by its mint in that case.
  const obligationAccount = await rpc
    .getAccountInfo(decoded.obligation, { encoding: 'base64' })
    .send();
  const obligation =
    obligationAccount.value === null
      ? null
      : decodeObligation(bytesOf(obligationAccount.value.data));
  const collateralReserve =
    obligation?.depositReserves[0] ??
    (await reserveHoldingTheMint(rpc, cluster, decoded.collateralMint)) ??
    decoded.borrowReserve;

  const reserves = await rpc
    .getMultipleAccounts([collateralReserve, decoded.borrowReserve], {
      encoding: 'base64',
    })
    .send();
  const collateralReserveAccount = reserves.value[0];
  const borrowReserveAccount = reserves.value[1];
  if (
    collateralReserveAccount === null ||
    collateralReserveAccount === undefined ||
    borrowReserveAccount === null ||
    borrowReserveAccount === undefined
  ) {
    throw new Error('one of the reserves is not on this network');
  }
  const collateral = decodeReserve(bytesOf(collateralReserveAccount.data));
  const borrow = decodeReserve(bytesOf(borrowReserveAccount.data));

  const programs = await tokenProgramsOf(rpc, decoded);

  const [ownerCollateralAccount, ownerUsdcAccount, ownerDestinationAccount] =
    await Promise.all([
      associatedTokenAccount({
        owner,
        mint: decoded.collateralMint,
        tokenProgram: programs.collateral,
      }),
      associatedTokenAccount({
        owner,
        mint: decoded.borrowMint,
        tokenProgram: programs.borrow,
      }),
      associatedTokenAccount({
        owner,
        mint: decoded.destinationMint,
        tokenProgram: programs.destination,
      }),
    ]);

  const lendingMarketAuthority = await derive(cluster.kaminoLendingProgram, [
    LENDING_MARKET_AUTHORITY_SEED,
    asSeed(decoded.market),
  ]);
  const collateralObligationFarmState =
    collateral.collateralFarm === null
      ? undefined
      : await derive(cluster.kaminoFarmsProgram, [
          FARM_USER_STATE_SEED,
          asSeed(collateral.collateralFarm),
          asSeed(decoded.obligation),
        ]);

  const wanted = [
    {
      account: ownerCollateralAccount,
      mint: decoded.collateralMint,
      tokenProgram: programs.collateral,
    },
    {
      account: ownerUsdcAccount,
      mint: decoded.borrowMint,
      tokenProgram: programs.borrow,
    },
    {
      account: ownerDestinationAccount,
      mint: decoded.destinationMint,
      tokenProgram: programs.destination,
    },
  ];
  const held = await rpc
    .getMultipleAccounts(
      wanted.map((entry) => entry.account),
      { encoding: 'base64' },
    )
    .send();
  const instructions: Instruction[] = [];
  wanted.forEach((entry, index) => {
    if (held.value[index] == null) {
      instructions.push(createAssociatedTokenAccount({ payer: owner, owner, ...entry }));
    }
  });

  instructions.push(
    getRescueInstruction({
      owner: createNoopSigner(owner),
      position,
      collateralMint: decoded.collateralMint,
      destinationMint: decoded.destinationMint,
      borrowMint: decoded.borrowMint,
      positionCollateralAccount: decoded.collateralTokenAccount,
      positionUsdcAccount: decoded.usdcTokenAccount,
      positionDestinationAccount: decoded.destinationTokenAccount,
      ownerCollateralAccount,
      ownerUsdcAccount,
      ownerDestinationAccount,
      obligation: decoded.obligation,
      lendingMarket: decoded.market,
      lendingMarketAuthority,
      collateralReserve,
      collateralReserveCollateralSupply: collateral.collateralSupplyVault,
      collateralReserveCollateralMint: collateral.collateralMint,
      collateralReserveLiquiditySupply: collateral.liquiditySupplyVault,
      ...(collateral.collateralFarm === null ||
      collateralObligationFarmState === undefined
        ? {}
        : {
            collateralReserveFarmState: collateral.collateralFarm,
            collateralObligationFarmState,
          }),
      borrowReserve: decoded.borrowReserve,
      scopePrices: collateral.scopePriceAccount,
      borrowScopePrices: borrow.scopePriceAccount,
      farmsProgram: cluster.kaminoFarmsProgram,
      kaminoProgram: cluster.kaminoLendingProgram,
      instructionSysvar: INSTRUCTIONS_SYSVAR,
      kaminoCollateralTokenProgram: TOKEN_PROGRAM,
      collateralTokenProgram: programs.collateral,
      borrowTokenProgram: programs.borrow,
      destinationTokenProgram: programs.destination,
    }),
  );

  const owed = obligation?.borrowedAmountScaledFor(decoded.borrowReserve) ?? 0n;
  const borrowObligationFarmState =
    borrow.debtFarm === null
      ? undefined
      : await derive(cluster.kaminoFarmsProgram, [
          FARM_USER_STATE_SEED,
          asSeed(borrow.debtFarm),
          asSeed(decoded.obligation),
        ]);

  // Rescue hands every token back but never repays, so a loan left standing is settled from the
  // owner's own USDC and the account is closed, which is what leaves the wallet with nothing of
  // ours attached to it.
  const settle: Instruction[][] = [];
  if (owed > 0n) {
    settle.push([
      getRepayInstruction({
        owner: createNoopSigner(owner),
        position,
        borrowMint: decoded.borrowMint,
        positionCollateralAccount: decoded.collateralTokenAccount,
        positionUsdcAccount: decoded.usdcTokenAccount,
        positionDestinationAccount: decoded.destinationTokenAccount,
        ownerUsdcAccount,
        obligation: decoded.obligation,
        lendingMarket: decoded.market,
        lendingMarketAuthority,
        collateralReserve,
        borrowReserve: decoded.borrowReserve,
        borrowReserveLiquiditySupply: borrow.liquiditySupplyVault,
        ...(borrow.debtFarm === null || borrowObligationFarmState === undefined
          ? {}
          : {
              borrowReserveFarmState: borrow.debtFarm,
              borrowObligationFarmState,
            }),
        collateralScopePrices: collateral.scopePriceAccount,
        borrowScopePrices: borrow.scopePriceAccount,
        farmsProgram: cluster.kaminoFarmsProgram,
        kaminoProgram: cluster.kaminoLendingProgram,
        instructionSysvar: INSTRUCTIONS_SYSVAR,
        borrowTokenProgram: programs.borrow,
        requestedAmount: REPAY_EVERYTHING,
      }),
    ]);
  }

  // The first rescue can only take out what the loan allowed, and rounding leaves dust behind, so
  // it runs again once the debt is gone. Only an obligation with nothing in it can be closed.
  settle.push([...instructions]);

  settle.push([
    getClosePositionInstruction({
      owner: createNoopSigner(owner),
      position,
      positionCollateralAccount: decoded.collateralTokenAccount,
      positionUsdcAccount: decoded.usdcTokenAccount,
      positionDestinationAccount: decoded.destinationTokenAccount,
      obligation: decoded.obligation,
      collateralReserve,
      collateralTokenProgram: programs.collateral,
      borrowTokenProgram: programs.borrow,
      destinationTokenProgram: programs.destination,
    }),
  ]);

  return {
    rescue: instructions,
    settle,
    stillOwedUsdc: owed > 0n ? wholeUsdcFromScaled(owed) : null,
  };
}

function wholeUsdcFromScaled(scaled: bigint): string {
  const raw = scaled / (1n << 60n);
  const whole = raw / 10n ** BigInt(USDC_DECIMALS);
  const part = raw % 10n ** BigInt(USDC_DECIMALS);
  return `${whole}.${part.toString().padStart(USDC_DECIMALS, '0').slice(0, 2)}`;
}

export async function signAndSend(
  rpc: Rpc<SolanaRpcApi>,
  owner: Address,
  instructions: readonly Instruction[],
  sign: (unsigned: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (draft) => setTransactionMessageFeePayer(owner, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, draft),
    (draft) => setTransactionMessageComputeUnitLimit(COMPUTE_UNIT_LIMIT, draft),
    (draft) =>
      setTransactionMessageLoadedAccountsDataSizeLimit(
        LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
        draft,
      ),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
  );

  const unsigned = Uint8Array.from(
    atob(getBase64EncodedWireTransaction(compileTransaction(message))),
    (character) => character.charCodeAt(0),
  );

  const signed = await sign(unsigned);
  const base64 = btoa(String.fromCharCode(...signed)) as Base64EncodedWireTransaction;
  let signature;
  try {
    signature = await rpc
      .sendTransaction(base64, { encoding: 'base64', preflightCommitment: 'confirmed' })
      .send();
  } catch (failure) {
    throw new Error(`send failed: ${(failure as Error).message}`, { cause: failure });
  }
  await waitForIt(rpc, signature);
  return signature;
}

async function waitForIt(rpc: Rpc<SolanaRpcApi>, signature: Signature): Promise<void> {
  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err != null) {
      throw new Error('the chain refused that transaction');
    }
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }
    await new Promise((wake) => setTimeout(wake, A_SECOND));
  }
  throw new Error('that transaction did not confirm in time');
}

export function shorten(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
