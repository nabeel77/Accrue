import {
  appendTransactionMessageInstructions,
  compileTransactionMessage,
  createTransactionMessage,
  getCompiledTransactionMessageEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';

import {
  decodeLendingMarket,
  decodeObligation,
  decodeReserve,
  decodeScopePrice,
  getRefreshObligationInstruction,
  getRefreshReserveInstruction,
  type LendingMarketSnapshot,
  type ObligationSnapshot,
  type ReserveSnapshot,
  type ScopePrice,
} from '@accrue/solana/kamino';
import { KAMINO_LENDING_PROGRAM_ADDRESS } from '@accrue/solana';

export interface MarketReading {
  readonly obligation: ObligationSnapshot;
  readonly lendingMarket: LendingMarketSnapshot;
  readonly collateralReserve: ReserveSnapshot;
  readonly borrowReserve: ReserveSnapshot;
  readonly borrowReserveAddress: Address;
  readonly usdcPrice: ScopePrice;
  readonly currentSlot: bigint;
}

export interface MarketAddresses {
  readonly lendingMarket: Address;
  readonly obligation: Address;
  readonly collateralReserve: Address;
}

/**
 * The keeper never reads a stale loan to value. It asks the chain to run the same refresh the
 * program will run, then reads the result out of the simulation, exactly as `docs/keeper.md` says.
 */
export async function readTheMarketAfterARefresh(
  rpc: Rpc<SolanaRpcApi>,
  feePayer: Address,
  addresses: MarketAddresses,
): Promise<MarketReading> {
  const collateralReserve = decodeReserve(
    await fetchAccount(rpc, addresses.collateralReserve),
  );

  // The obligation names the reserves it holds, so the keeper never has to guess which one the
  // loan is in, and the refresh carries exactly the list the lending market expects.
  const beforeTheRefresh = decodeObligation(
    await fetchAccount(rpc, addresses.obligation),
  );
  const borrowReserveAddress = beforeTheRefresh.borrowReserves[0];
  if (borrowReserveAddress === undefined) {
    throw new Error('this obligation owes the market nothing');
  }
  const borrowReserve = decodeReserve(await fetchAccount(rpc, borrowReserveAddress));

  const heldReserves = [
    ...beforeTheRefresh.depositReserves,
    ...beforeTheRefresh.borrowReserves,
  ];
  const refreshes: Instruction[] = [
    refreshReserveInstruction(
      addresses.collateralReserve,
      addresses.lendingMarket,
      collateralReserve,
    ),
    refreshReserveInstruction(
      borrowReserveAddress,
      addresses.lendingMarket,
      borrowReserve,
    ),
    withTheReservesTheObligationHolds(
      getRefreshObligationInstruction(
        { lendingMarket: addresses.lendingMarket, obligation: addresses.obligation },
        { programAddress: KAMINO_LENDING_PROGRAM_ADDRESS },
      ),
      heldReserves,
    ),
  ];

  const wire = await compileForSimulation(rpc, feePayer, refreshes);
  const simulation = await rpc
    .simulateTransaction(wire, {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: { addresses: [addresses.obligation], encoding: 'base64' },
    })
    .send();

  if (simulation.value.err !== null) {
    throw new Error('the lending market refused to refresh this obligation');
  }
  const refreshed = simulation.value.accounts[0];
  if (!refreshed) {
    throw new Error('the refresh simulation returned no obligation');
  }

  const usdcPrice = decodeScopePrice(
    await fetchAccount(rpc, borrowReserve.scopePriceAccount),
    borrowReserve.scopeFeedIndex,
  );

  return {
    obligation: decodeObligation(
      new Uint8Array(Buffer.from(refreshed.data[0], 'base64')),
    ),
    lendingMarket: decodeLendingMarket(await fetchAccount(rpc, addresses.lendingMarket)),
    collateralReserve,
    borrowReserve,
    borrowReserveAddress,
    usdcPrice,
    currentSlot: simulation.context.slot,
  };
}

function refreshReserveInstruction(
  reserve: Address,
  lendingMarket: Address,
  snapshot: ReserveSnapshot,
): Instruction {
  return getRefreshReserveInstruction(
    { reserve, lendingMarket, scopePrices: snapshot.scopePriceAccount },
    { programAddress: KAMINO_LENDING_PROGRAM_ADDRESS },
  );
}

function withTheReservesTheObligationHolds(
  instruction: Instruction,
  reserves: readonly Address[],
): Instruction {
  return {
    ...instruction,
    accounts: [
      ...(instruction.accounts ?? []),
      ...reserves.map((reserve) => ({ address: reserve, role: 1 as const })),
    ],
  };
}

const SIGNATURE_LENGTH = 64;

/**
 * A simulation needs no signature, so the transaction carries one empty slot and the chain is
 * asked to skip the check.
 */
async function compileForSimulation(
  rpc: Rpc<SolanaRpcApi>,
  feePayer: Address,
  instructions: readonly Instruction[],
): Promise<Base64EncodedWireTransaction> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(feePayer, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, draft),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
  );

  const encoded = getCompiledTransactionMessageEncoder().encode(
    compileTransactionMessage(message),
  );
  const unsigned = new Uint8Array(1 + SIGNATURE_LENGTH + encoded.length);
  unsigned[0] = 1;
  unsigned.set(encoded, 1 + SIGNATURE_LENGTH);
  return Buffer.from(unsigned).toString('base64') as Base64EncodedWireTransaction;
}

async function fetchAccount(
  rpc: Rpc<SolanaRpcApi>,
  account: Address,
): Promise<Uint8Array> {
  const response = await rpc.getAccountInfo(account, { encoding: 'base64' }).send();
  if (response.value === null) {
    throw new Error('an account the guard needs does not exist');
  }
  return new Uint8Array(Buffer.from(response.value.data[0], 'base64'));
}
