import type { Base64EncodedWireTransaction } from '@solana/kit';

const { address } = await import('@solana/kit');
const { currentCluster } = await import('@accrue/solana');
const { getPositionDecoder } =
  await import('../../packages/solana/src/program/accounts/position.js');
const { shortenAddress } = await import('../../packages/core/src/logging/shorten.js');
const { buildAddCollateral, buildProtectByOwner, buildRepay, buildUnwindAndClose } =
  await import('../../apps/web/src/server/positions/buildOwnerAction.js');
const { buildTopUp } = await import('../../apps/web/src/server/positions/buildTopUp.js');
const { everyReason } =
  await import('../../apps/web/src/server/positions/whyTheChainRefused.js');
const { connectToDevnet, reportStep } = await import('./shared.js');

const A_LITTLE_USDC = 1_000_000n;
const A_LITTLE_STOCK = 1_000_000n;

// The build simulates with a fresh blockhash. A send uses the one compiled in, so this asks the
// chain the question a send asks: is this transaction, as built, still one you would take?
async function asASendWouldSeeIt(
  rpc: Awaited<ReturnType<typeof connectToDevnet>>['rpc'],
  wire: Base64EncodedWireTransaction,
): Promise<string> {
  const { value } = await rpc
    .simulateTransaction(wire, {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: 'confirmed',
    })
    .send();
  if (value.err === null) {
    return 'the chain would take it';
  }
  const logs = (value.logs ?? []).slice(-3).join(' | ');
  return `the chain refuses it: ${JSON.stringify(value.err)} ${logs}`;
}

// Every owner action, built and simulated for a position that is already open. Nothing is sent:
// this is the same code the routes run, so whatever the chain says appears here.
async function main(): Promise<void> {
  const { rpc } = connectToDevnet();
  const cluster = currentCluster();
  const programAddress = process.env['ACCRUE_PROGRAM_ID'];
  if (programAddress === undefined || programAddress === '') {
    throw new Error('ACCRUE_PROGRAM_ID is not set.');
  }

  const found = await rpc
    .getProgramAccounts(address(programAddress), {
      encoding: 'base64',
      commitment: 'confirmed',
    })
    .send();
  const positions = found.flatMap((entry) => {
    try {
      const data = Uint8Array.from(Buffer.from(entry.account.data[0], 'base64'));
      return [{ address: entry.pubkey, position: getPositionDecoder().decode(data) }];
    } catch {
      return [];
    }
  });

  for (const one of positions) {
    const inputs = {
      owner: one.position.owner,
      collateralMint: one.position.collateralMint,
      destinationMint: one.position.destinationMint,
    };
    reportStep(
      `position ${shortenAddress(one.address)} owned by ${shortenAddress(inputs.owner)}`,
    );

    await tryIt('repay', async () =>
      buildRepay({ ...inputs, requestedAmountRaw: A_LITTLE_USDC }),
    );
    await tryIt('add collateral', async () =>
      buildAddCollateral({ ...inputs, collateralAmountRaw: A_LITTLE_STOCK }),
    );
    await tryIt('top up', async () =>
      buildTopUp({ ...inputs, collateralAmountRaw: A_LITTLE_STOCK }),
    );
    await tryIt('protect', async () => buildProtectByOwner(inputs));
    await tryIt('unwind', async () => buildUnwindAndClose(inputs));
  }
  reportStep(`on ${cluster.name}`);
}

async function tryIt(
  what: string,
  build: () => Promise<
    { readonly built: readonly unknown[] } | { readonly refused: { message: string } }
  >,
): Promise<void> {
  try {
    const outcome = await build();
    if ('refused' in outcome) {
      reportStep(`  refused  ${what.padEnd(16)}${outcome.refused.message}`);
      return;
    }
    reportStep(`  built    ${what.padEnd(16)}${outcome.built.length} transaction(s)`);
    const built = outcome.built as readonly {
      transaction: Base64EncodedWireTransaction;
    }[];
    const first = built[0];
    if (first !== undefined) {
      const { rpc } = connectToDevnet();
      reportStep(
        `  sent?    ${what.padEnd(16)}${await asASendWouldSeeIt(rpc, first.transaction)}`,
      );
    }
  } catch (failure) {
    reportStep(`  threw    ${what.padEnd(16)}${everyReason(failure)}`);
    if (process.env['ACCRUE_SHOW_EVERY_LOG'] === 'true') {
      const lines = (failure as { lastLogLines?: string }).lastLogLines;
      reportStep(lines ?? '');
    }
  }
}

await main();
