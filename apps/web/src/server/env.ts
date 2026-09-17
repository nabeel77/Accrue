import 'server-only';

export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. See .env.example.`);
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

export function isDevnet(): boolean {
  return (process.env['SOLANA_CLUSTER'] ?? 'mainnet') === 'devnet';
}

export function rpcUrl(): string {
  return required('HELIUS_RPC_URL');
}

/** The caps from the environment are a ceiling, never raised in code. */
export const CAPS = {
  maxSlippageBps: (): number => number('MAX_SLIPPAGE_BPS', 50),
  maxPriceImpactPct: (): number => number('MAX_PRICE_IMPACT_PCT', 1),
  maxShareOfAvailableLiquidity: (): number =>
    number('MAX_SHARE_OF_AVAILABLE_LIQUIDITY', 0.1),
  minPositionUsd: (): number => number('MIN_POSITION_USD', 10),
  maxPositionUsd: (): number => number('MAX_POSITION_USD', 50_000),
  maxLtvShareOfLimit: (): number => number('MAX_LTV_SHARE_OF_LIMIT', 0.75),
  priorityFeeLamports: (): number => number('PRIORITY_FEE_LAMPORTS', 50_000),
  positionBuildingEnabled: (): boolean => flagIsOn('POSITION_BUILDING_ENABLED'),
} as const;
