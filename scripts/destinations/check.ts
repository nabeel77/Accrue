import { address, type Address } from '@solana/kit';

import { DESTINATIONS, type Destination } from '@accrue/core';
import {
  clusterName,
  createAccrueRpc,
  createSwapRouter,
  currentCluster,
  requestsPerSecondFromTheEnvironment,
  type SwapRouter,
} from '@accrue/solana';
import { decodeScopePrice } from '@accrue/solana/kamino';

const USDC_DECIMALS = 6;
const SIZES_IN_WHOLE_USDC = [100n, 1_000n];
const HIGHEST_PRICE_IMPACT_BPS = 100;
const MAX_SLIPPAGE_BPS = 50;
const ROUTE_MAX_ACCOUNTS = 28;
const PERMISSIONED_MINT_EXTENSIONS = [
  'transferHook',
  'permanentDelegate',
  'defaultAccountState',
];

interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

function rpcUrl(): string {
  const url = process.env['HELIUS_RPC_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'HELIUS_RPC_URL is not set, so there is nothing to read the chain with.',
    );
  }
  return url;
}

// On the sandbox a destination is the mock mint of the same symbol.
function mintOnThisCluster(destination: Destination): Address {
  if (clusterName() === 'mainnet') {
    return address(destination.mainnetMint);
  }
  const mint = currentCluster().mints[destination.symbol];
  if (mint === undefined) {
    throw new Error(`${destination.symbol} has no mint on this cluster`);
  }
  return mint;
}

async function theMintIsNotPermissioned(
  rpc: ReturnType<typeof createAccrueRpc>['rpc'],
  mint: Address,
): Promise<CheckResult> {
  const { value } = await rpc.getAccountInfo(mint, { encoding: 'jsonParsed' }).send();
  if (value === null) {
    return {
      name: 'the mint is not permissioned',
      passed: false,
      detail: 'no such mint',
    };
  }
  const parsed = value.data as unknown as {
    parsed?: { info?: { extensions?: { extension?: string }[] } };
  };
  const extensions = (parsed.parsed?.info?.extensions ?? []).map(
    (entry) => entry.extension ?? '',
  );
  const blocking = extensions.filter((name) =>
    PERMISSIONED_MINT_EXTENSIONS.includes(name),
  );
  return {
    name: 'the mint is not permissioned',
    passed: blocking.length === 0,
    detail:
      blocking.length === 0
        ? 'nothing stops a program account from holding it'
        : `carries ${blocking.join(', ')}`,
  };
}

async function theRouterQuotesBothSizes(
  router: SwapRouter,
  usdcMint: Address,
  destinationMint: Address,
  signingAuthority: Address,
): Promise<CheckResult> {
  const impacts: string[] = [];
  for (const size of SIZES_IN_WHOLE_USDC) {
    const amountIn = size * 10n ** BigInt(USDC_DECIMALS);
    try {
      await router.findRoute({
        inputMint: usdcMint,
        outputMint: destinationMint,
        amountIn,
        slippageBps: MAX_SLIPPAGE_BPS,
        maxAccounts: ROUTE_MAX_ACCOUNTS,
        signingAuthority,
      });
      impacts.push(`${size} routed`);
    } catch (failure) {
      return {
        name: `the router quotes ${SIZES_IN_WHOLE_USDC.join(' and ')} USDC under ${HIGHEST_PRICE_IMPACT_BPS} basis points of impact`,
        passed: false,
        detail: `${size} USDC: ${failure instanceof Error ? failure.message : 'no route'}`,
      };
    }
  }
  return {
    name: `the router quotes ${SIZES_IN_WHOLE_USDC.join(' and ')} USDC under ${HIGHEST_PRICE_IMPACT_BPS} basis points of impact`,
    passed: true,
    detail: impacts.join(', '),
  };
}

async function scopePricesIt(
  rpc: ReturnType<typeof createAccrueRpc>['rpc'],
  destination: Destination,
): Promise<CheckResult> {
  const scopeAccount = currentCluster().scopePriceAccount;
  const { value } = await rpc.getAccountInfo(scopeAccount, { encoding: 'base64' }).send();
  if (value === null) {
    return { name: 'Scope prices it', passed: false, detail: 'no oracle account' };
  }
  try {
    const price = decodeScopePrice(
      Uint8Array.from(Buffer.from(value.data[0], 'base64')),
      destination.scopeFeedIndex,
    );
    const passed = price.value > 0n;
    return {
      name: 'Scope prices it',
      passed,
      detail: passed
        ? `feed ${destination.scopeFeedIndex} reads ${Number(price.value) / 10 ** Number(price.exponent)}`
        : `feed ${destination.scopeFeedIndex} is empty`,
    };
  } catch (failure) {
    return {
      name: 'Scope prices it',
      passed: false,
      detail: failure instanceof Error ? failure.message : 'unreadable',
    };
  }
}

function theExitTypeIsDocumented(destination: Destination): CheckResult {
  const known: readonly string[] = ['instant', 'request'];
  return {
    name: 'the exit type comes from the issuer',
    passed: known.includes(destination.exitType),
    detail: `${destination.exitType}, recorded ${destination.eligibility.checkedOn}`,
  };
}

function theYieldSourceIsOneSentence(destination: Destination): CheckResult {
  const sentence = destination.yieldSource.trim();
  const endings = sentence.match(/[.!?]/gu) ?? [];
  const passed = sentence.length > 0 && endings.length === 1 && sentence.endsWith('.');
  return {
    name: 'the yield source is one honest sentence',
    passed,
    detail: sentence,
  };
}

async function main(): Promise<void> {
  const url = rpcUrl();
  const { rpc } = createAccrueRpc({
    url,
    requestsPerSecond: requestsPerSecondFromTheEnvironment(),
  });
  const router = createSwapRouter({
    rpc,
    jupiterApiUrl: process.env['JUPITER_API_URL'] ?? 'https://lite-api.jup.ag',
    jupiterApiKey: process.env['JUPITER_API_KEY'],
  });
  const cluster = currentCluster();
  const usdcMint = cluster.mints['USDC'];
  if (usdcMint === undefined) {
    throw new Error('this cluster has no USDC mint');
  }

  console.log(`checking ${DESTINATIONS.length} destinations on ${cluster.name}`);
  let everythingPassed = true;

  for (const destination of DESTINATIONS) {
    const mint = mintOnThisCluster(destination);
    console.log('');
    console.log(`${destination.symbol}  ${mint}`);

    const results: CheckResult[] = [
      await theMintIsNotPermissioned(rpc, mint),
      await theRouterQuotesBothSizes(router, usdcMint, mint, usdcMint),
      await scopePricesIt(rpc, destination),
      theExitTypeIsDocumented(destination),
      theYieldSourceIsOneSentence(destination),
    ];

    for (const result of results) {
      console.log(
        `  ${result.passed ? 'pass' : 'FAIL'}  ${result.name}: ${result.detail}`,
      );
      everythingPassed = everythingPassed && result.passed;
    }
  }

  console.log('');
  console.log(
    everythingPassed
      ? 'every destination passes every check'
      : 'a destination failed a check and must not be shown',
  );
  if (!everythingPassed) {
    process.exitCode = 1;
  }
}

await main();
