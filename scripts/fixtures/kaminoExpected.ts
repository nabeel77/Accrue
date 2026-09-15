import { encodeBase58 } from '../shared/base58.js';

const KAMINO_API_URL = 'https://api.kamino.finance';

export const XSTOCKS_MARKET_ADDRESS = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua';
export const OBLIGATION_FIXTURE_ADDRESS = '7BACsXdze3FporEnXEbuSHStPPQ58tpZuWb7jgsUYmV';

interface ReserveMetricsRow {
  reserve: string;
  liquidityToken: string;
  liquidityTokenMint: string;
  maxLtv: string;
}

interface ObligationApiRow {
  obligationAddress: string;
  state: {
    lendingMarket: string;
    owner: string;
    deposits: {
      depositReserve: string;
      depositedAmount: string;
      marketValueSf: string;
    }[];
    borrows: { borrowReserve: string; borrowedAmountSf: string; marketValueSf: string }[];
  };
}

export interface ExpectedReserve {
  reserve: string;
  symbol: string;
  liquidity_mint: string;
  loan_to_value_pct: number;
}

export interface ExpectedObligationEntry {
  reserve: string;
  amount: string;
}

export interface KaminoExpectedDecoding {
  source: string;
  fetched_at: string;
  market: string;
  reserves: ExpectedReserve[];
  obligation: {
    address: string;
    lending_market: string;
    owner: string;
    deposits: ExpectedObligationEntry[];
    borrows: ExpectedObligationEntry[];
  };
}

async function fetchJson<Shape>(url: string): Promise<Shape> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return (await response.json()) as Shape;
}

function percentFromRatio(ratio: string): number {
  const asPercent = Number.parseFloat(ratio) * 100;
  const rounded = Math.round(asPercent);
  if (Math.abs(asPercent - rounded) > 1e-6) {
    throw new Error(`maxLtv ${ratio} is not a whole percent`);
  }
  return rounded;
}

export async function fetchKaminoExpectedDecoding(): Promise<KaminoExpectedDecoding> {
  const metrics = await fetchJson<ReserveMetricsRow[]>(
    `${KAMINO_API_URL}/kamino-market/${XSTOCKS_MARKET_ADDRESS}/reserves/metrics`,
  );

  const obligationOwner = await findObligationOwner();
  const obligations = await fetchJson<ObligationApiRow[]>(
    `${KAMINO_API_URL}/kamino-market/${XSTOCKS_MARKET_ADDRESS}/users/${obligationOwner}/obligations`,
  );
  const obligation = obligations.find(
    (row) => row.obligationAddress === OBLIGATION_FIXTURE_ADDRESS,
  );
  if (obligation === undefined) {
    throw new Error(`The API no longer returns ${OBLIGATION_FIXTURE_ADDRESS}`);
  }

  const isEmpty = (address: string): boolean =>
    address === '11111111111111111111111111111111';

  return {
    source: `${KAMINO_API_URL}, decoded by the lending market's own service`,
    fetched_at: new Date().toISOString(),
    market: XSTOCKS_MARKET_ADDRESS,
    reserves: metrics.map((row) => ({
      reserve: row.reserve,
      symbol: row.liquidityToken,
      liquidity_mint: row.liquidityTokenMint,
      loan_to_value_pct: percentFromRatio(row.maxLtv),
    })),
    obligation: {
      address: obligation.obligationAddress,
      lending_market: obligation.state.lendingMarket,
      owner: obligation.state.owner,
      deposits: obligation.state.deposits
        .filter((entry) => !isEmpty(entry.depositReserve))
        .map((entry) => ({
          reserve: entry.depositReserve,
          amount: entry.depositedAmount,
        })),
      borrows: obligation.state.borrows
        .filter((entry) => !isEmpty(entry.borrowReserve))
        .map((entry) => ({
          reserve: entry.borrowReserve,
          amount: entry.borrowedAmountSf,
        })),
    },
  };
}

async function findObligationOwner(): Promise<string> {
  const response = await fetch('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [OBLIGATION_FIXTURE_ADDRESS, { encoding: 'base64' }],
    }),
  });
  const payload = (await response.json()) as {
    result: { value: { data: [string, string] } | null };
  };
  if (payload.result.value === null) {
    throw new Error(`${OBLIGATION_FIXTURE_ADDRESS} no longer exists`);
  }
  const bytes = Buffer.from(payload.result.value.data[0], 'base64');
  return encodeBase58(bytes.subarray(64, 96));
}
