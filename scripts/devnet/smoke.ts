import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
} from '@solana-program/token-2022';
import type { Address, Instruction, KeyPairSigner } from '@solana/kit';

import {
  createSwapRouter,
  INSTRUCTIONS_SYSVAR_ADDRESS,
  JUPITER_V6_PROGRAM_ADDRESS,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  KAMINO_LENDING_PROGRAM_ADDRESS,
  sandboxRouteOutput,
  TOKEN_PROGRAM_ADDRESS,
  type SwapRouter,
} from '@accrue/solana';
import {
  findKaminoObligation,
  findKaminoUserMetadata,
  findLendingMarketAuthority,
  reserveAccounts,
  decodeReserve,
  type ReserveSnapshot,
} from '@accrue/solana/kamino';
import {
  findConfigPda,
  findPositionPda,
  getBuyDestinationInstruction,
  getClosePositionInstruction,
  getOpenPositionInstruction,
  getRepayInstruction,
  getRescueInstruction,
  getUnwindInstruction,
  type Strategy,
} from '@accrue/solana/program';

import {
  accountData,
  accountOwner,
  adminSigner,
  connectToDevnet,
  explorerLink,
  measureTransaction,
  namedSigner,
  readRegistry,
  reportStep,
  sendInstructions,
  type Cluster,
} from './shared.js';
import { tokenProgramAddress } from './mints.js';
import { currentPrices, savePrices, startingPrices } from './priceBook.js';
import { writeEveryPrice } from './prices.js';
import { setThePoolRates } from './router.js';
import { tokenBySymbol, wholeUnits, type SandboxToken } from './tokens.js';

const STRATEGY: Strategy = {
  targetLtvBps: 4_000,
  protectLtvBps: 5_000,
  growBelowLtvBps: 3_000,
  growEnabled: true,
  exitOnFlagEnabled: true,
};

const COLLATERAL_WHOLE_DOLLARS = 20;
const BORROW_AMOUNT = 7_000_000n;
const GUARD_COMPUTE_UNIT_LIMIT = 600_000;
const ROUTE_MAX_ACCOUNTS = 28;
const MAX_SLIPPAGE_BPS = 100;
// A position is worth a little less than it owes the moment it opens, so the owner keeps enough
// USDC for unwind to take the difference from.
const USDC_FOR_THE_SHORTFALL = 50;

/**
 * The generated client stands a missing optional account in as the Accrue program itself, and the
 * program checks each of these against the cluster module, so they are named every time.
 */
const THE_PROGRAMS_EVERY_CALL_NAMES = {
  farmsProgram: KAMINO_FARMS_PROGRAM_ADDRESS,
  kaminoProgram: KAMINO_LENDING_PROGRAM_ADDRESS,
  instructionSysvar: INSTRUCTIONS_SYSVAR_ADDRESS,
  swapProgram: JUPITER_V6_PROGRAM_ADDRESS,
} as const;

interface World {
  readonly cluster: Cluster;
  readonly owner: KeyPairSigner;
  readonly router: SwapRouter;
  readonly lending: Address;
  readonly market: Address;
  readonly marketAuthority: Address;
  readonly prices: Address;
  readonly configAddress: Address;
  readonly treasury: Address;
  readonly collateral: SandboxToken;
  readonly borrow: SandboxToken;
  readonly destination: SandboxToken;
  readonly mints: Record<string, Address>;
  readonly reserves: Record<string, Address>;
}

function mintOf(world: World, token: SandboxToken): Address {
  const mint = world.mints[token.symbol];
  if (mint === undefined) {
    throw new Error(`${token.symbol} has no mint in the devnet registry`);
  }
  return mint;
}

function reserveOf(world: World, token: SandboxToken): Address {
  const reserve = world.reserves[token.symbol];
  if (reserve === undefined) {
    throw new Error(`${token.symbol} has no reserve in the devnet registry`);
  }
  return reserve;
}

async function readReserve(world: World, reserve: Address): Promise<ReserveSnapshot> {
  const data = await accountData(world.cluster, reserve);
  if (data === null) {
    throw new Error(`${reserve} is not on devnet`);
  }
  return decodeReserve(data);
}

async function tokenAccount(
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Address> {
  const [account] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  return account;
}

async function fundTheOwner(world: World): Promise<void> {
  const prices = currentPrices();
  const price = prices[world.collateral.symbol] ?? world.collateral.startingPrice;
  const wanted: readonly { token: SandboxToken; amount: bigint }[] = [
    {
      token: world.collateral,
      amount: wholeUnits(world.collateral, (COLLATERAL_WHOLE_DOLLARS * 4) / price),
    },
    {
      token: world.borrow,
      amount: wholeUnits(world.borrow, USDC_FOR_THE_SHORTFALL),
    },
  ];

  const instructions = [];
  for (const { token, amount } of wanted) {
    const mint = mintOf(world, token);
    const tokenProgram = tokenProgramAddress(token);
    const account = await tokenAccount(world.owner.address, mint, tokenProgram);
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: world.owner,
        ata: account,
        owner: world.owner.address,
        mint,
        tokenProgram,
      }),
      getMintToInstruction(
        { mint, token: account, mintAuthority: world.owner, amount },
        { programAddress: tokenProgram },
      ),
    );
  }

  const signature = await sendInstructions(world.cluster, world.owner, instructions);
  report('the owner is funded with stock and with USDC for the shortfall', signature);
}

/** The program expects every one of these to exist already, so the owner opens them first. */
async function openTheTokenAccounts(world: World, at: PositionAddresses): Promise<void> {
  const pairs: readonly { account: Address; owner: Address; token: SandboxToken }[] = [
    { account: at.ownerUsdc, owner: world.owner.address, token: world.borrow },
    {
      account: at.ownerDestination,
      owner: world.owner.address,
      token: world.destination,
    },
    { account: at.positionCollateral, owner: at.position, token: world.collateral },
    { account: at.positionUsdc, owner: at.position, token: world.borrow },
    { account: at.positionDestination, owner: at.position, token: world.destination },
  ];
  const signature = await sendInstructions(
    world.cluster,
    world.owner,
    pairs.map((pair) =>
      getCreateAssociatedTokenIdempotentInstruction({
        payer: world.owner,
        ata: pair.account,
        owner: pair.owner,
        mint: mintOf(world, pair.token),
        tokenProgram: tokenProgramAddress(pair.token),
      }),
    ),
  );
  report('the owner and the position have their token accounts', signature);
}

function report(what: string, signature: string): void {
  reportStep(`  ${what}`);
  reportStep(`    ${signature}`);
  reportStep(`    ${explorerLink(signature)}`);
}

interface PositionAddresses {
  readonly position: Address;
  readonly obligation: Address;
  readonly ownerCollateral: Address;
  readonly ownerUsdc: Address;
  readonly ownerDestination: Address;
  readonly positionCollateral: Address;
  readonly positionUsdc: Address;
  readonly positionDestination: Address;
}

async function positionAddresses(world: World): Promise<PositionAddresses> {
  const collateralMint = mintOf(world, world.collateral);
  const borrowMint = mintOf(world, world.borrow);
  const destinationMint = mintOf(world, world.destination);
  const collateralProgram = tokenProgramAddress(world.collateral);
  const destinationProgram = tokenProgramAddress(world.destination);

  const [position] = await findPositionPda({
    owner: world.owner.address,
    collateralMint,
    destinationMint,
  });
  return {
    position,
    obligation: await findKaminoObligation({
      owner: position,
      lendingMarket: world.market,
    }),
    ownerCollateral: await tokenAccount(
      world.owner.address,
      collateralMint,
      collateralProgram,
    ),
    ownerUsdc: await tokenAccount(world.owner.address, borrowMint, TOKEN_PROGRAM_ADDRESS),
    ownerDestination: await tokenAccount(
      world.owner.address,
      destinationMint,
      destinationProgram,
    ),
    positionCollateral: await tokenAccount(position, collateralMint, collateralProgram),
    positionUsdc: await tokenAccount(position, borrowMint, TOKEN_PROGRAM_ADDRESS),
    positionDestination: await tokenAccount(
      position,
      destinationMint,
      destinationProgram,
    ),
  };
}

/**
 * open_position can do the whole thing in one call: deposit, borrow and swap, with the route
 * carried inline. The two call shape the rest of this script uses is what the program's own suite
 * does, so a hostile route can be aimed at the swap on its own; it is not a devnet limit.
 */
async function openInOneTransaction(world: World, at: PositionAddresses): Promise<void> {
  const route = await world.router.findRoute({
    inputMint: mintOf(world, world.borrow),
    outputMint: mintOf(world, world.destination),
    amountIn: BORROW_AMOUNT,
    slippageBps: MAX_SLIPPAGE_BPS,
    maxAccounts: ROUTE_MAX_ACCOUNTS,
    signingAuthority: at.position,
  });
  const instruction = await openPositionInstruction(world, at, {
    leaveUsdcForLaterSwap: false,
    minimumDestinationAmount: sandboxRouteOutput(route),
    jupiterRouteData: route.data,
  });
  const whole = {
    ...instruction,
    accounts: [...(instruction.accounts ?? []), ...route.accounts],
  };

  const shape = await measureTransaction(world.cluster, world.owner, [whole], {
    computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT,
  });
  reportStep(
    `  one version 1 transaction: ${shape.bytes} bytes of 4096, ${shape.uniqueAddresses} unique addresses of 64, ${shape.computeUnits ?? '—'} compute units`,
  );

  const signature = await sendInstructions(world.cluster, world.owner, [whole], {
    computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT,
  });
  report('open_position with the swap carried inline', signature);
}

interface OpenChoices {
  readonly leaveUsdcForLaterSwap: boolean;
  readonly minimumDestinationAmount: bigint;
  readonly jupiterRouteData: Uint8Array;
}

async function openPositionInstruction(
  world: World,
  at: PositionAddresses,
  choices: OpenChoices,
): Promise<Instruction> {
  // close_position hands the token accounts and their rent back, so every open opens them again.
  await openTheTokenAccounts(world, at);
  const collateralMint = mintOf(world, world.collateral);
  const borrowMint = mintOf(world, world.borrow);
  const destinationMint = mintOf(world, world.destination);
  const collateralReserve = reserveOf(world, world.collateral);
  const borrowReserve = reserveOf(world, world.borrow);
  const collateralVaults = reserveAccounts(await readReserve(world, collateralReserve));
  const borrowVaults = reserveAccounts(await readReserve(world, borrowReserve));

  const prices = currentPrices();
  const price = prices[world.collateral.symbol] ?? world.collateral.startingPrice;
  const collateralAmount = wholeUnits(world.collateral, COLLATERAL_WHOLE_DOLLARS / price);

  const instruction = getOpenPositionInstruction({
    owner: world.owner,
    config: world.configAddress,
    position: at.position,
    collateralMint,
    destinationMint,
    borrowMint,
    ownerCollateralAccount: at.ownerCollateral,
    positionCollateralAccount: at.positionCollateral,
    positionUsdcAccount: at.positionUsdc,
    positionDestinationAccount: at.positionDestination,
    lendingMarket: world.market,
    lendingMarketAuthority: world.marketAuthority,
    obligation: at.obligation,
    userMetadata: await findKaminoUserMetadata(at.position),
    collateralReserve,
    collateralReserveLiquiditySupply: collateralVaults.liquiditySupply,
    collateralReserveCollateralMint: collateralVaults.collateralMint,
    collateralReserveCollateralSupply: collateralVaults.collateralSupply,
    borrowReserve,
    borrowReserveLiquiditySupply: borrowVaults.liquiditySupply,
    borrowReserveFeeReceiver: borrowVaults.liquidityFeeReceiver,
    scopePrices: world.prices,
    collateralTokenProgram: tokenProgramAddress(world.collateral),
    kaminoCollateralTokenProgram: TOKEN_PROGRAM_ADDRESS,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationTokenProgram: tokenProgramAddress(world.destination),
    ...THE_PROGRAMS_EVERY_CALL_NAMES,
    collateralAmount,
    borrowAmount: BORROW_AMOUNT,
    minimumDestinationAmount: choices.minimumDestinationAmount,
    strategy: STRATEGY,
    leaveUsdcForLaterSwap: choices.leaveUsdcForLaterSwap,
    jupiterRouteData: choices.jupiterRouteData,
  });
  return instruction;
}

async function openThePosition(world: World, at: PositionAddresses): Promise<void> {
  const instruction = await openPositionInstruction(world, at, {
    leaveUsdcForLaterSwap: true,
    minimumDestinationAmount: 0n,
    jupiterRouteData: new Uint8Array(0),
  });
  const signature = await sendInstructions(world.cluster, world.owner, [instruction], {
    computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT,
  });
  report(
    `open_position: ${COLLATERAL_WHOLE_DOLLARS} dollars of ${world.collateral.symbol}, borrowing ${
      Number(BORROW_AMOUNT) / 1_000_000
    } USDC`,
    signature,
  );
}

async function buyTheDestination(world: World, at: PositionAddresses): Promise<void> {
  const borrowMint = mintOf(world, world.borrow);
  const destinationMint = mintOf(world, world.destination);
  const route = await world.router.findRoute({
    inputMint: borrowMint,
    outputMint: destinationMint,
    amountIn: BORROW_AMOUNT,
    slippageBps: MAX_SLIPPAGE_BPS,
    maxAccounts: ROUTE_MAX_ACCOUNTS,
    signingAuthority: at.position,
  });

  const instruction = getBuyDestinationInstruction({
    owner: world.owner,
    config: world.configAddress,
    position: at.position,
    positionCollateralAccount: at.positionCollateral,
    positionUsdcAccount: at.positionUsdc,
    positionDestinationAccount: at.positionDestination,
    obligation: at.obligation,
    collateralReserve: reserveOf(world, world.collateral),
    swapProgram: JUPITER_V6_PROGRAM_ADDRESS,
    minimumDestinationAmount: sandboxRouteOutput(route),
    jupiterRouteData: route.data,
  });

  const signature = await sendInstructions(
    world.cluster,
    world.owner,
    [{ ...instruction, accounts: [...instruction.accounts, ...route.accounts] }],
    { computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT },
  );
  report('buy_destination: the borrowed USDC becomes the yield token', signature);
}

/** Every run starts from the same prices, so one run never leaves the next one somewhere odd. */
async function resetThePrices(world: World): Promise<void> {
  const starting = startingPrices();
  savePrices(starting);
  const priceFeed = (await namedSigner('price-feed')).address;
  const written = await writeEveryPrice(
    world.cluster,
    world.owner,
    priceFeed,
    world.prices,
    starting,
  );
  report('the oracle is back at its starting prices', written);
  const swapProgram = (await namedSigner('honest-swap')).address;
  const rates = await setThePoolRates(world.cluster, world.owner, swapProgram, starting);
  if (rates !== undefined) {
    report('the router follows the oracle', rates);
  }
}

async function unwindThePosition(world: World, at: PositionAddresses): Promise<void> {
  const borrowMint = mintOf(world, world.borrow);
  const destinationMint = mintOf(world, world.destination);
  const collateralReserve = reserveOf(world, world.collateral);
  const borrowReserve = reserveOf(world, world.borrow);
  const collateralVaults = reserveAccounts(await readReserve(world, collateralReserve));
  const borrowVaults = reserveAccounts(await readReserve(world, borrowReserve));

  const destinationBalance = await tokenBalance(world, at.positionDestination);
  const route = await world.router.findRoute({
    inputMint: destinationMint,
    outputMint: borrowMint,
    amountIn: destinationBalance,
    slippageBps: MAX_SLIPPAGE_BPS,
    maxAccounts: ROUTE_MAX_ACCOUNTS,
    signingAuthority: at.position,
  });

  const instruction = getUnwindInstruction({
    owner: world.owner,
    config: world.configAddress,
    position: at.position,
    collateralMint: mintOf(world, world.collateral),
    destinationMint,
    borrowMint,
    ownerCollateralAccount: at.ownerCollateral,
    ownerUsdcAccount: at.ownerUsdc,
    ownerDestinationAccount: at.ownerDestination,
    treasuryUsdcAccount: world.treasury,
    positionCollateralAccount: at.positionCollateral,
    positionUsdcAccount: at.positionUsdc,
    positionDestinationAccount: at.positionDestination,
    lendingMarket: world.market,
    lendingMarketAuthority: world.marketAuthority,
    obligation: at.obligation,
    collateralReserve,
    collateralReserveCollateralSupply: collateralVaults.collateralSupply,
    collateralReserveCollateralMint: collateralVaults.collateralMint,
    collateralReserveLiquiditySupply: collateralVaults.liquiditySupply,
    borrowReserve,
    borrowReserveLiquiditySupply: borrowVaults.liquiditySupply,
    collateralScopePrices: world.prices,
    borrowScopePrices: world.prices,
    collateralTokenProgram: tokenProgramAddress(world.collateral),
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationTokenProgram: tokenProgramAddress(world.destination),
    ...THE_PROGRAMS_EVERY_CALL_NAMES,
    minimumUsdcOut: sandboxRouteOutput(route),
    jupiterRouteData: route.data,
  });

  const signature = await sendInstructions(
    world.cluster,
    world.owner,
    [{ ...instruction, accounts: [...instruction.accounts, ...route.accounts] }],
    { computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT },
  );
  report('unwind: everything sold, repaid and returned', signature);
}

async function rescueThePosition(world: World, at: PositionAddresses): Promise<void> {
  const collateralReserve = reserveOf(world, world.collateral);
  const collateralVaults = reserveAccounts(await readReserve(world, collateralReserve));

  const instruction = getRescueInstruction({
    owner: world.owner,
    position: at.position,
    collateralMint: mintOf(world, world.collateral),
    destinationMint: mintOf(world, world.destination),
    borrowMint: mintOf(world, world.borrow),
    ownerCollateralAccount: at.ownerCollateral,
    ownerUsdcAccount: at.ownerUsdc,
    ownerDestinationAccount: at.ownerDestination,
    positionCollateralAccount: at.positionCollateral,
    positionUsdcAccount: at.positionUsdc,
    positionDestinationAccount: at.positionDestination,
    lendingMarket: world.market,
    lendingMarketAuthority: world.marketAuthority,
    obligation: at.obligation,
    collateralReserve,
    collateralReserveCollateralSupply: collateralVaults.collateralSupply,
    collateralReserveCollateralMint: collateralVaults.collateralMint,
    collateralReserveLiquiditySupply: collateralVaults.liquiditySupply,
    borrowReserve: reserveOf(world, world.borrow),
    scopePrices: world.prices,
    borrowScopePrices: world.prices,
    farmsProgram: KAMINO_FARMS_PROGRAM_ADDRESS,
    kaminoProgram: KAMINO_LENDING_PROGRAM_ADDRESS,
    instructionSysvar: INSTRUCTIONS_SYSVAR_ADDRESS,
    collateralTokenProgram: tokenProgramAddress(world.collateral),
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationTokenProgram: tokenProgramAddress(world.destination),
  });

  const signature = await sendInstructions(world.cluster, world.owner, [instruction], {
    computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT,
  });
  report('rescue: no conditions, no oracle, everything back', signature);
}

// The program repays the smaller of what is asked for and what is owed, so this asks for all of it.
const REPAY_EVERYTHING = 2n ** 64n - 1n;

/** Rescue hands the tokens back but never repays, so settling the loan is its own step. */
async function repayEverything(world: World, at: PositionAddresses): Promise<void> {
  const borrowReserve = reserveOf(world, world.borrow);
  const borrowVaults = reserveAccounts(await readReserve(world, borrowReserve));

  const instruction = getRepayInstruction({
    owner: world.owner,
    position: at.position,
    borrowMint: mintOf(world, world.borrow),
    positionCollateralAccount: at.positionCollateral,
    positionUsdcAccount: at.positionUsdc,
    positionDestinationAccount: at.positionDestination,
    ownerUsdcAccount: at.ownerUsdc,
    obligation: at.obligation,
    lendingMarket: world.market,
    lendingMarketAuthority: world.marketAuthority,
    collateralReserve: reserveOf(world, world.collateral),
    borrowReserve,
    borrowReserveLiquiditySupply: borrowVaults.liquiditySupply,
    collateralScopePrices: world.prices,
    borrowScopePrices: world.prices,
    farmsProgram: KAMINO_FARMS_PROGRAM_ADDRESS,
    kaminoProgram: KAMINO_LENDING_PROGRAM_ADDRESS,
    instructionSysvar: INSTRUCTIONS_SYSVAR_ADDRESS,
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    requestedAmount: REPAY_EVERYTHING,
  });

  const signature = await sendInstructions(world.cluster, world.owner, [instruction], {
    computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT,
  });
  report("repay: the loan is settled from the owner's own USDC", signature);
}

async function closeThePosition(world: World, at: PositionAddresses): Promise<void> {
  const instruction = getClosePositionInstruction({
    owner: world.owner,
    position: at.position,
    positionCollateralAccount: at.positionCollateral,
    positionUsdcAccount: at.positionUsdc,
    positionDestinationAccount: at.positionDestination,
    obligation: at.obligation,
    collateralReserve: reserveOf(world, world.collateral),
    collateralTokenProgram: tokenProgramAddress(world.collateral),
    borrowTokenProgram: TOKEN_PROGRAM_ADDRESS,
    destinationTokenProgram: tokenProgramAddress(world.destination),
  });

  const signature = await sendInstructions(world.cluster, world.owner, [instruction], {
    computeUnitLimit: GUARD_COMPUTE_UNIT_LIMIT,
  });
  report('close_position: the empty accounts and their rent go back', signature);
}

async function tokenBalance(world: World, account: Address): Promise<bigint> {
  const data = await accountData(world.cluster, account);
  if (data === null) {
    return 0n;
  }
  let value = 0n;
  for (let index = 71; index >= 64; index -= 1) {
    value = (value << 8n) | BigInt(data[index] ?? 0);
  }
  return value;
}

async function buildTheWorld(): Promise<World> {
  const cluster = connectToDevnet();
  const owner = await adminSigner();
  const registry = readRegistry();
  const lending = (await namedSigner('klend')).address;
  const market = registry.market as Address | undefined;
  const prices = registry.prices as Address | undefined;
  if (market === undefined || prices === undefined) {
    throw new Error('Run pnpm devnet:market and pnpm devnet:prices first.');
  }
  const [configAddress] = await findConfigPda();
  const treasury = registry.treasury;
  if (treasury === undefined) {
    throw new Error('the treasury account is not in the devnet registry yet');
  }

  return {
    cluster,
    owner,
    router: createSwapRouter({
      rpc: cluster.rpc,
      jupiterApiUrl: '',
    }),
    lending,
    market,
    marketAuthority: await findLendingMarketAuthority(market),
    prices,
    configAddress,
    treasury: treasury as Address,
    collateral: tokenBySymbol('NVDAx'),
    borrow: tokenBySymbol('USDC'),
    destination: tokenBySymbol('ONyc'),
    mints: (registry.mints ?? {}) as Record<string, Address>,
    reserves: (registry.reserves ?? {}) as Record<string, Address>,
  };
}

/**
 * Rescue hands back every token the position holds and withdraws what the market allows, which
 * while a loan is outstanding is not all of the collateral. So it runs, the loan is settled from
 * the owner's own wallet, and it runs again to take back what the debt had been holding.
 */
const OBLIGATION_HAS_DEBT_OFFSET = 2_287;

async function theObligationStillOwes(
  world: World,
  at: PositionAddresses,
): Promise<boolean> {
  if ((await accountOwner(world.cluster, at.obligation)) !== world.lending) {
    return false;
  }
  const data = await accountData(world.cluster, at.obligation);
  return data !== null && data[OBLIGATION_HAS_DEBT_OFFSET] !== 0;
}

async function takeItAllBackAndClose(world: World, at: PositionAddresses): Promise<void> {
  await rescueThePosition(world, at);
  if (await theObligationStillOwes(world, at)) {
    await repayEverything(world, at);
    await rescueThePosition(world, at);
  }
  await closeThePosition(world, at);
}

async function clearAnythingLeftOver(world: World, at: PositionAddresses): Promise<void> {
  const existing = await accountData(world.cluster, at.position);
  if (existing === null) {
    return;
  }
  reportStep('  a position from an earlier run is still here, taking it back first');
  await takeItAllBackAndClose(world, at);
}

async function main(): Promise<void> {
  const world = await buildTheWorld();
  const at = await positionAddresses(world);

  reportStep(`owner    ${world.owner.address}`);
  reportStep(`position ${at.position}`);
  reportStep(`config   ${world.configAddress}`);
  reportStep('');

  await resetThePrices(world);
  await fundTheOwner(world);
  await clearAnythingLeftOver(world, at);

  // Handy before a program upgrade that changes the position account's length: the old program
  // has to be the one that empties and closes it.
  if (process.argv.includes('--clear-only')) {
    reportStep('');
    reportStep('nothing of ours is left on chain');
    return;
  }

  if (process.argv.includes('--one-transaction')) {
    await openInOneTransaction(world, at);
    reportStep('');
    reportStep(`a guarded position is standing at ${at.position}`);
    return;
  }

  await openThePosition(world, at);
  await buyTheDestination(world, at);

  // What the keeper run needs: one position, open, holding the yield token, and nothing else done
  // to it.
  if (process.argv.includes('--leave-it-open')) {
    reportStep('');
    reportStep(`a guarded position is standing at ${at.position}`);
    return;
  }
  await unwindThePosition(world, at);
  await closeThePosition(world, at);
  await openThePosition(world, at);
  await takeItAllBackAndClose(world, at);

  reportStep('');
  reportStep('the whole life of a position ran on devnet');
}

if (process.argv[1]?.endsWith('smoke.ts') === true) {
  await main();
}
