export interface SandboxToken {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly tokenProgram: 'token' | 'token2022';
  readonly feedIndex: number;
  readonly startingPrice: number;
  readonly priceExponent: number;
  readonly mainnetMint: string;
  readonly templateReserve: string;
  readonly faucetGrant: number;
  readonly scaledUiMultiplier?: number;
}

export const SANDBOX_TOKENS: readonly SandboxToken[] = [
  {
    symbol: 'USDC',
    name: 'USDC',
    decimals: 6,
    tokenProgram: 'token',
    feedIndex: 13,
    startingPrice: 1,
    priceExponent: 8,
    mainnetMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    templateReserve: 'reserve_usdc',
    faucetGrant: 1_000,
  },
  {
    symbol: 'NVDAx',
    name: 'NVDAX',
    decimals: 8,
    tokenProgram: 'token2022',
    feedIndex: 332,
    startingPrice: 175,
    priceExponent: 15,
    mainnetMint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    templateReserve: 'reserve_nvdax',
    faucetGrant: 5,
    scaledUiMultiplier: 1,
  },
  {
    symbol: 'SPYx',
    name: 'SPYX',
    decimals: 8,
    tokenProgram: 'token2022',
    feedIndex: 344,
    startingPrice: 650,
    priceExponent: 15,
    mainnetMint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    templateReserve: 'reserve_spyx',
    faucetGrant: 2,
    scaledUiMultiplier: 1,
  },
  {
    symbol: 'ONyc',
    name: 'ONYC',
    decimals: 9,
    tokenProgram: 'token',
    feedIndex: 350,
    startingPrice: 1.02,
    priceExponent: 17,
    mainnetMint: '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5',
    templateReserve: 'reserve_onyc_onre_market',
    faucetGrant: 100,
  },
];

export function tokenBySymbol(symbol: string): SandboxToken {
  const found = SANDBOX_TOKENS.find(
    (token) => token.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  if (found === undefined) {
    throw new Error(
      `${symbol} is not a sandbox token. Pick one of ${SANDBOX_TOKENS.map((token) => token.symbol).join(', ')}.`,
    );
  }
  return found;
}

export function scopeValueFor(token: SandboxToken, price: number): bigint {
  const scaled = BigInt(Math.round(price * 1_000_000));
  const remainingExponent = BigInt(token.priceExponent) - 6n;
  if (remainingExponent < 0n) {
    throw new Error(`${token.symbol} prices need at least six decimal places`);
  }
  return scaled * 10n ** remainingExponent;
}

export function wholeUnits(token: SandboxToken, amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** token.decimals));
}
