import 'server-only';

export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. See apps/web/.env.example.`);
  }
  return value;
}

export function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export function number(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function flagIsOn(name: string): boolean {
  return (process.env[name] ?? '').toLowerCase() !== 'false';
}

export type ClusterName = 'mainnet' | 'devnet' | 'localnet';

export function clusterName(): ClusterName {
  const chosen = required('SOLANA_CLUSTER');
  if (chosen !== 'mainnet' && chosen !== 'devnet' && chosen !== 'localnet') {
    throw new Error(`SOLANA_CLUSTER is ${chosen}, which is not a cluster we know`);
  }
  return chosen;
}

export function isDevnet(): boolean {
  return clusterName() === 'devnet';
}

export function rpcUrl(): string {
  return required('HELIUS_RPC_URL');
}

// The ceilings are the numbers in the example file.
const CEILINGS = {
  MAX_SLIPPAGE_BPS: 50,
  MAX_PRICE_IMPACT_PCT: 1,
  MAX_SHARE_OF_AVAILABLE_LIQUIDITY: 0.1,
  MAX_POSITION_USD: 50_000,
  MAX_LTV_SHARE_OF_LIMIT: 0.75,
  PRIORITY_FEE_LAMPORTS: 50_000,
} as const;

const FLOORS = {
  MIN_POSITION_USD: 10,
} as const;

function capped(name: keyof typeof CEILINGS): number {
  const value = Number(required(name));
  if (!Number.isFinite(value)) {
    throw new Error(`${name} is not a number`);
  }
  if (value > CEILINGS[name]) {
    throw new Error(`${name} is ${value}, over the ${CEILINGS[name]} allowed in code`);
  }
  return value;
}

function floored(name: keyof typeof FLOORS): number {
  const value = Number(required(name));
  if (!Number.isFinite(value)) {
    throw new Error(`${name} is not a number`);
  }
  if (value < FLOORS[name]) {
    throw new Error(`${name} is ${value}, under the ${FLOORS[name]} required in code`);
  }
  return value;
}

export const CAPS = {
  maxSlippageBps: (): number => capped('MAX_SLIPPAGE_BPS'),
  maxPriceImpactPct: (): number => capped('MAX_PRICE_IMPACT_PCT'),
  maxShareOfAvailableLiquidity: (): number => capped('MAX_SHARE_OF_AVAILABLE_LIQUIDITY'),
  minPositionUsd: (): number => floored('MIN_POSITION_USD'),
  maxPositionUsd: (): number => capped('MAX_POSITION_USD'),
  maxLtvShareOfLimit: (): number => capped('MAX_LTV_SHARE_OF_LIMIT'),
  priorityFeeLamports: (): number => capped('PRIORITY_FEE_LAMPORTS'),
  positionBuildingEnabled: (): boolean => flagIsOn('POSITION_BUILDING_ENABLED'),
} as const;

// Read once when the server starts so a bad setting is a failure to boot, not a bad position.
export function everyCapIsWithinItsCeiling(): void {
  for (const read of Object.values(CAPS)) {
    read();
  }
  clusterName();
  rpcUrl();
}
