import { resolve } from 'node:path';

import {
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { Clock, LiteSVM } from 'litesvm';
import type { FailedTransactionMetadata, TransactionMetadata } from 'litesvm';

import { usdPerWholeTokenScaled } from '@accrue/core';
import {
  JUPITER_V6_PROGRAM_ADDRESS,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  KAMINO_LENDING_PROGRAM_ADDRESS,
  PRIMARY_TRANSACTION_VERSION,
  TOKEN_PROGRAM_ADDRESS,
  decodeTokenAccountAmount,
} from '@accrue/solana';
import {
  decodeObligation,
  decodeReserve,
  decodeScopePrice,
  findAssociatedTokenAccount,
  findLendingMarketAuthority,
  reserveAccounts,
  type ObligationSnapshot,
  type ReserveSnapshot,
  type ScopePrice,
} from '@accrue/solana/kamino';
import {
  ACCRUE_PROGRAM_ADDRESS,
  findConfigPda,
  getInitializeConfigInstruction,
  getSetPausedInstruction,
  getUpdateConfigInstruction,
  type CollateralEntry,
  type Config,
  type ConfigLimits,
  type DestinationEntry,
} from '@accrue/solana/program';
import { getConfigDecoder } from '@accrue/solana/program';

import { LOADED_ACCOUNTS_DATA_SIZE_LIMIT } from '../../../apps/keeper/src/transaction.js';
import { mintAccountData, tokenAccountData } from './accounts.js';
import {
  capturedAddress,
  capturedData,
  fixturesDirectory,
  loadMainnetSnapshot,
  repositoryRoot,
  type MainnetSnapshot,
} from './fixtures.js';

export const COLLATERAL_RESERVE_LABEL = 'reserve_nvdax';
export const BORROW_RESERVE_LABEL = 'reserve_usdc';
export const DESTINATION_MINT_LABEL = 'mint_onyc';
export const MARKET_LABEL = 'xstocks_market';
export const SCOPE_PRICES_LABEL = 'oracle_scope_prices';

export const ONYC_SCOPE_FEED_INDEX = 350;
export const ONYC_SCOPE_TWAP_FEED_INDEX = 478;
export const DESTINATION_DECIMALS = 9;

export const RESERVE_STATUS_OFFSET = 4_856;
export const RESERVE_AUTODELEVERAGE_OFFSET = 5_502;
export const RESERVE_STATUS_OBSOLETE = 1;

const RESERVE_TWAP_CHAIN_OFFSET = 5_152;
const SCOPE_FIRST_PRICE_OFFSET = 40;
const SCOPE_DATED_PRICE_LENGTH = 56;

const SWAP_AUTHORITY_SEED = 'swap';
const SWAP_VAULT_SEED = 'vault';
export const SWAP_VAULT_BALANCE = 1_000_000_000_000_000n;

const FUNDING_LAMPORTS = lamports(100_000_000_000n);
const TOKEN_ACCOUNT_RENT = lamports(2_039_280n);
const MINT_ACCOUNT_RENT = lamports(1_461_600n);
const SLOTS_PER_SECOND = 2n;
const SLOTS_PER_EPOCH = 432_000n;
const TRANSACTION_COMPUTE_LIMIT = 1_400_000;

const addresses = getAddressEncoder();

export interface ReserveUnderTest {
  readonly address: Address;
  snapshot: ReserveSnapshot;
}

export interface Landed {
  readonly computeUnits: number;
  readonly logs: readonly string[];
}

export function defaultLimits(): ConfigLimits {
  return {
    keeperBountyBps: 10,
    keeperBountyCapUsdc: 5_000_000n,
    performanceFeeBps: 1_000,
    maxSlippageBps: 100,
    maxPriceAgeSlots: 150n,
    minProtectIntervalSeconds: 600n,
    minGrowIntervalSeconds: 3_600n,
    maxShareOfAvailableBps: 1_000,
    minPositionUsd: 10n,
    maxPositionUsd: 50n,
  };
}

function failed(
  result: TransactionMetadata | FailedTransactionMetadata,
): result is FailedTransactionMetadata {
  return typeof (result as FailedTransactionMetadata).err === 'function';
}

/**
 * The same world the program's own suite runs in: the real mainnet accounts, the real lending
 * market and farms programs, and one of the two test routers standing in at the router's address.
 */
export class World {
  routerIsHostile = false;

  private constructor(
    readonly svm: LiteSVM,
    readonly snapshot: MainnetSnapshot,
    public slot: bigint,
    public unixTimestamp: bigint,
    readonly owner: KeyPairSigner,
    readonly admin: KeyPairSigner,
    readonly guardian: KeyPairSigner,
    readonly keeper: KeyPairSigner,
    readonly stranger: KeyPairSigner,
    readonly configAddress: Address,
    readonly market: Address,
    readonly marketAuthority: Address,
    readonly scopePrices: Address,
    readonly collateral: ReserveUnderTest,
    readonly borrow: ReserveUnderTest,
    readonly destinationMint: Address,
    readonly destinationTokenProgram: Address,
    readonly swapAuthority: Address,
    public treasuryUsdcAccount: Address,
  ) {}

  static async create(): Promise<World> {
    const snapshot = loadMainnetSnapshot();
    const svm = new LiteSVM();

    svm.warpToSlot(snapshot.slot);
    svm.setClock(
      new Clock(
        snapshot.slot,
        snapshot.unixTimestamp,
        snapshot.slot / SLOTS_PER_EPOCH,
        snapshot.slot / SLOTS_PER_EPOCH,
        snapshot.unixTimestamp,
      ),
    );

    for (const account of snapshot.accounts) {
      const data = new Uint8Array(Buffer.from(account.data_base64, 'base64'));
      svm.setAccount({
        address: address(account.address),
        data,
        executable: account.executable,
        lamports: lamports(BigInt(account.lamports)),
        programAddress: address(account.owner),
        space: BigInt(data.length),
      });
    }

    svm.addProgramFromFile(
      KAMINO_LENDING_PROGRAM_ADDRESS,
      resolve(fixturesDirectory, 'programs/kamino_lending.so'),
    );
    svm.addProgramFromFile(
      KAMINO_FARMS_PROGRAM_ADDRESS,
      resolve(fixturesDirectory, 'programs/kamino_farms.so'),
    );
    svm.addProgramFromFile(
      ACCRUE_PROGRAM_ADDRESS,
      resolve(repositoryRoot, 'target/deploy/accrue.so'),
    );

    const [owner, admin, guardian, keeper, stranger] = await Promise.all([
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
    ]);
    for (const signer of [owner, admin, guardian, keeper, stranger]) {
      svm.airdrop(signer.address, FUNDING_LAMPORTS);
    }

    const market = capturedAddress(snapshot, MARKET_LABEL);
    const [configAddress] = await findConfigPda();
    const [swapAuthority] = await getProgramDerivedAddress({
      programAddress: JUPITER_V6_PROGRAM_ADDRESS,
      seeds: [SWAP_AUTHORITY_SEED],
    });

    const world = new World(
      svm,
      snapshot,
      snapshot.slot,
      snapshot.unixTimestamp,
      owner,
      admin,
      guardian,
      keeper,
      stranger,
      configAddress,
      market,
      await findLendingMarketAuthority(market),
      capturedAddress(snapshot, SCOPE_PRICES_LABEL),
      {
        address: capturedAddress(snapshot, COLLATERAL_RESERVE_LABEL),
        snapshot: decodeReserve(capturedData(snapshot, COLLATERAL_RESERVE_LABEL)),
      },
      {
        address: capturedAddress(snapshot, BORROW_RESERVE_LABEL),
        snapshot: decodeReserve(capturedData(snapshot, BORROW_RESERVE_LABEL)),
      },
      capturedAddress(snapshot, DESTINATION_MINT_LABEL),
      TOKEN_PROGRAM_ADDRESS,
      swapAuthority,
      address('11111111111111111111111111111111'),
    );

    world.seedReserveVaults();
    world.treasuryUsdcAccount = await world.createTokenAccount({
      mint: world.borrow.snapshot.liquidityMint,
      owner: admin.address,
      amount: 0n,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    await world.initializeConfig();
    return world;
  }

  async send(
    instruction: Instruction,
    feePayer: KeyPairSigner,
  ): Promise<Landed | FailedTransactionMetadata> {
    this.svm.expireBlockhash();
    const message = pipe(
      createTransactionMessage({ version: PRIMARY_TRANSACTION_VERSION }),
      (draft) => setTransactionMessageFeePayerSigner(feePayer, draft),
      (draft) => this.svm.setTransactionMessageLifetimeUsingLatestBlockhash(draft),
      (draft) => setTransactionMessageComputeUnitLimit(TRANSACTION_COMPUTE_LIMIT, draft),
      (draft) =>
        setTransactionMessageLoadedAccountsDataSizeLimit(
          LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
          draft,
        ),
      (draft) => appendTransactionMessageInstruction(instruction, draft),
    );

    const signed = await signTransactionMessageWithSigners(message);
    const result = this.svm.sendTransaction(signed);
    if (failed(result)) {
      return result;
    }
    return { computeUnits: Number(result.computeUnitsConsumed()), logs: result.logs() };
  }

  async sendExpectingSuccess(
    instruction: Instruction,
    feePayer: KeyPairSigner,
    what: string,
  ): Promise<Landed> {
    const result = await this.send(instruction, feePayer);
    if ('err' in result) {
      throw new Error(`${what} reverted: ${result.toString()}`);
    }
    return result;
  }

  async installSwapProgram(fileName: string): Promise<void> {
    this.routerIsHostile = fileName.includes('hostile');
    this.svm.addProgramFromFile(
      JUPITER_V6_PROGRAM_ADDRESS,
      resolve(repositoryRoot, 'target/deploy', fileName),
    );

    for (const [mint, tokenProgram] of [
      [
        this.collateral.snapshot.liquidityMint,
        this.collateral.snapshot.liquidityTokenProgram,
      ],
      [this.borrow.snapshot.liquidityMint, TOKEN_PROGRAM_ADDRESS],
      [this.destinationMint, this.destinationTokenProgram],
    ] as const) {
      this.setTokenAccount({
        account: await this.swapVault(mint),
        mint,
        owner: this.swapAuthority,
        amount: SWAP_VAULT_BALANCE,
        tokenProgram,
      });
    }
  }

  async swapVault(mint: Address): Promise<Address> {
    const [vault] = await getProgramDerivedAddress({
      programAddress: JUPITER_V6_PROGRAM_ADDRESS,
      seeds: [SWAP_VAULT_SEED, new Uint8Array(addresses.encode(mint))],
    });
    return vault;
  }

  setTokenAccount(input: {
    readonly account: Address;
    readonly mint: Address;
    readonly owner: Address;
    readonly amount: bigint;
    readonly tokenProgram: Address;
  }): void {
    const data = tokenAccountData(input);
    this.svm.setAccount({
      address: input.account,
      data,
      executable: false,
      lamports: TOKEN_ACCOUNT_RENT,
      programAddress: input.tokenProgram,
      space: BigInt(data.length),
    });
  }

  /** Which token program a mint in this world belongs to. */
  tokenProgramFor(mint: Address): Address {
    if (mint === this.collateral.snapshot.liquidityMint) {
      return this.collateral.snapshot.liquidityTokenProgram;
    }
    if (mint === this.destinationMint) {
      return this.destinationTokenProgram;
    }
    return TOKEN_PROGRAM_ADDRESS;
  }

  tokenAccountOf(owner: Address, mint: Address): Promise<Address> {
    return findAssociatedTokenAccount({
      owner,
      mint,
      tokenProgram: this.tokenProgramFor(mint),
    });
  }

  async createTokenAccount(input: {
    readonly mint: Address;
    readonly owner: Address;
    readonly amount: bigint;
    readonly tokenProgram: Address;
  }): Promise<Address> {
    const account = await findAssociatedTokenAccount({
      owner: input.owner,
      mint: input.mint,
      tokenProgram: input.tokenProgram,
    });
    this.setTokenAccount({ ...input, account });
    return account;
  }

  private setMintAccount(input: {
    readonly account: Address;
    readonly mintAuthority: Address;
    readonly supply: bigint;
    readonly decimals: number;
  }): void {
    const data = mintAccountData(input);
    this.svm.setAccount({
      address: input.account,
      data,
      executable: false,
      lamports: MINT_ACCOUNT_RENT,
      programAddress: TOKEN_PROGRAM_ADDRESS,
      space: BigInt(data.length),
    });
  }

  private seedReserveVaults(): void {
    for (const reserve of [this.collateral, this.borrow]) {
      const vaults = reserveAccounts(reserve.snapshot);
      this.setTokenAccount({
        account: vaults.liquiditySupply,
        mint: reserve.snapshot.liquidityMint,
        owner: this.marketAuthority,
        amount: reserve.snapshot.liquidityAvailableAmount,
        tokenProgram: vaults.liquidityTokenProgram,
      });
      this.setTokenAccount({
        account: vaults.liquidityFeeReceiver,
        mint: reserve.snapshot.liquidityMint,
        owner: this.marketAuthority,
        amount: 0n,
        tokenProgram: vaults.liquidityTokenProgram,
      });
      this.setMintAccount({
        account: vaults.collateralMint,
        mintAuthority: this.marketAuthority,
        supply: reserve.snapshot.collateralMintTotalSupply,
        decimals: reserve.snapshot.liquidityMintDecimals,
      });
      this.setTokenAccount({
        account: vaults.collateralSupply,
        mint: vaults.collateralMint,
        owner: this.marketAuthority,
        amount: reserve.snapshot.collateralMintTotalSupply,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
    }
  }

  private async initializeConfig(): Promise<void> {
    await this.sendExpectingSuccess(
      getInitializeConfigInstruction({
        deployer: this.admin,
        config: this.configAddress,
        treasury: this.treasuryUsdcAccount,
        admin: this.admin.address,
        guardian: this.guardian.address,
        borrowMint: this.borrow.snapshot.liquidityMint,
        borrowReserve: this.borrow.address,
        limits: defaultLimits(),
      }),
      this.admin,
      'initialize_config',
    );

    const collateral: CollateralEntry = {
      mint: this.collateral.snapshot.liquidityMint,
      reserve: this.collateral.address,
      tokenProgram: this.collateral.snapshot.liquidityTokenProgram,
      scopePriceAccount: this.scopePrices,
      scopeFeedIndex: this.collateral.snapshot.scopeFeedIndex,
      enabled: true,
    };
    const destination: DestinationEntry = {
      mint: this.destinationMint,
      tokenProgram: this.destinationTokenProgram,
      scopePriceAccount: this.scopePrices,
      scopeFeedIndex: ONYC_SCOPE_FEED_INDEX,
      enabled: true,
    };

    await this.updateConfig({ collateral });
    await this.updateConfig({ destination });
  }

  async updateConfig(update: {
    readonly limits?: ConfigLimits;
    readonly collateral?: CollateralEntry;
    readonly destination?: DestinationEntry;
  }): Promise<void> {
    await this.sendExpectingSuccess(
      getUpdateConfigInstruction({
        admin: this.admin,
        config: this.configAddress,
        limits: update.limits ?? null,
        treasury: null,
        guardian: null,
        adminArg: null,
        collateral: update.collateral ?? null,
        destination: update.destination ?? null,
        borrowMint: null,
        borrowReserve: null,
      }),
      this.admin,
      'update_config',
    );
  }

  async pauseGrows(): Promise<void> {
    await this.sendExpectingSuccess(
      getSetPausedInstruction({
        authority: this.guardian,
        config: this.configAddress,
        openPaused: null,
        growPaused: true,
      }),
      this.guardian,
      'set_paused',
    );
  }

  config(): Config {
    return getConfigDecoder().decode(this.accountData(this.configAddress));
  }

  accountData(account: Address): Uint8Array {
    const found = this.svm.getAccount(account);
    if (!found.exists) {
      throw new Error('that account does not exist in this world');
    }
    return new Uint8Array(found.data);
  }

  accountDataOrNull(account: Address): Uint8Array | null {
    const found = this.svm.getAccount(account);
    return found.exists ? new Uint8Array(found.data) : null;
  }

  tokenBalance(account: Address): bigint {
    const data = this.accountDataOrNull(account);
    return data === null ? 0n : decodeTokenAccountAmount(data);
  }

  obligation(account: Address): ObligationSnapshot {
    return decodeObligation(this.accountData(account));
  }

  /** After a leave the lending market closes the obligation, so there is nothing left to read. */
  obligationIfItExists(account: Address): ObligationSnapshot | null {
    const data = this.accountDataOrNull(account);
    return data === null || data.length === 0 ? null : decodeObligation(data);
  }

  reloadReserves(): void {
    this.collateral.snapshot = decodeReserve(this.accountData(this.collateral.address));
    this.borrow.snapshot = decodeReserve(this.accountData(this.borrow.address));
  }

  scopePrice(feedIndex: number): ScopePrice {
    return decodeScopePrice(this.accountData(this.scopePrices), feedIndex);
  }

  scopePriceScaled(feedIndex: number): bigint {
    return usdPerWholeTokenScaled(this.scopePrice(feedIndex));
  }

  writeScopePrice(feedIndex: number, value: bigint, lastUpdatedSlot: bigint): void {
    const data = this.accountData(this.scopePrices);
    const base = SCOPE_FIRST_PRICE_OFFSET + feedIndex * SCOPE_DATED_PRICE_LENGTH;
    writeLittleEndian(data, base, value, 8);
    writeLittleEndian(data, base + 16, lastUpdatedSlot, 8);
    writeLittleEndian(data, base + 24, this.unixTimestamp, 8);
    this.svm.setAccount({
      address: this.scopePrices,
      data,
      executable: false,
      lamports: this.svm.getBalance(this.scopePrices) ?? lamports(1n),
      programAddress: capturedAddressOwner(this.snapshot, SCOPE_PRICES_LABEL),
      space: BigInt(data.length),
    });
  }

  twapFeedOf(reserve: Address): number {
    const data = this.accountData(reserve);
    return Number(readLittleEndian(data, RESERVE_TWAP_CHAIN_OFFSET, 2));
  }

  everyFeedInPlay(): number[] {
    return [
      this.collateral.snapshot.scopeFeedIndex,
      this.twapFeedOf(this.collateral.address),
      this.borrow.snapshot.scopeFeedIndex,
      this.twapFeedOf(this.borrow.address),
      ONYC_SCOPE_FEED_INDEX,
      ONYC_SCOPE_TWAP_FEED_INDEX,
    ];
  }

  /** Moves a price and the twap it is checked against together, the way a real move would. */
  moveThePrice(feedIndex: number, numerator: bigint, denominator: bigint): void {
    const twap =
      feedIndex === this.collateral.snapshot.scopeFeedIndex
        ? this.twapFeedOf(this.collateral.address)
        : feedIndex === this.borrow.snapshot.scopeFeedIndex
          ? this.twapFeedOf(this.borrow.address)
          : ONYC_SCOPE_TWAP_FEED_INDEX;

    for (const feed of [feedIndex, twap]) {
      const price = this.scopePrice(feed);
      this.writeScopePrice(feed, (price.value * numerator) / denominator, this.slot);
    }
  }

  keepEveryScopePriceFresh(): void {
    for (const feed of this.everyFeedInPlay()) {
      this.writeScopePrice(feed, this.scopePrice(feed).value, this.slot);
    }
  }

  moveTimeForward(seconds: bigint): void {
    this.unixTimestamp += seconds;
    this.slot += seconds * SLOTS_PER_SECOND;
    this.svm.warpToSlot(this.slot);
    this.svm.setClock(
      new Clock(
        this.slot,
        this.unixTimestamp,
        this.slot / SLOTS_PER_EPOCH,
        this.slot / SLOTS_PER_EPOCH,
        this.unixTimestamp,
      ),
    );
    this.keepEveryScopePriceFresh();
  }

  setReserveByte(reserve: Address, offset: number, value: number): void {
    const data = this.accountData(reserve);
    data[offset] = value;
    this.svm.setAccount({
      address: reserve,
      data,
      executable: false,
      lamports: this.svm.getBalance(reserve) ?? lamports(1n),
      programAddress: KAMINO_LENDING_PROGRAM_ADDRESS,
      space: BigInt(data.length),
    });
    this.reloadReserves();
  }
}

function capturedAddressOwner(snapshot: MainnetSnapshot, label: string): Address {
  const found = snapshot.accounts.find((account) => account.label === label);
  if (found === undefined) {
    throw new Error(`no fixture account labelled ${label}`);
  }
  return address(found.owner);
}

function writeLittleEndian(
  data: Uint8Array,
  offset: number,
  value: bigint,
  byteLength: number,
): void {
  let remaining = value;
  for (let index = 0; index < byteLength; index += 1) {
    data[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function readLittleEndian(data: Uint8Array, offset: number, byteLength: number): bigint {
  let value = 0n;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return value;
}

/** What each round cost, printed the way the program's own suite prints it. */
export function reportComputeUnits(what: string, units: number | undefined): void {
  process.stdout.write(`${what}: ${units ?? 0} compute units\n`);
}
