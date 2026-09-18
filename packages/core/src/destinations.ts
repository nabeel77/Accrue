// Every yield token the app will offer, with the five eligibility checks recorded against it.
export type ExitType = 'instant' | 'request';

export interface EligibilityRecord {
  // Nothing on the mint stops a program account from holding it.
  readonly mintIsNotPermissioned: boolean;
  // The router quotes 100 and 1,000 USDC with price impact under one percent.
  readonly routesAtBothSizes: boolean;
  // Scope prices it, so the guard can sell it against a floor it computed itself.
  readonly hasAScopeFeed: boolean;
  // The exit type comes from the issuer's own documentation.
  readonly exitTypeIsDocumented: boolean;
  // The yield source fits in one honest sentence.
  readonly yieldSourceIsOneSentence: boolean;
  readonly checkedOn: string;
}

export interface Destination {
  readonly symbol: string;
  readonly name: string;
  readonly mainnetMint: string;
  readonly decimals: number;
  readonly tokenProgram: 'token' | 'token2022';
  readonly yieldSource: string;
  readonly exitType: ExitType;
  readonly scopeFeedIndex: number;
  readonly defiLlamaPoolId: string;
  // The last published target, used only until a destination snapshot replaces it.
  readonly targetRateBps: number;
  readonly targetRateSource: string;
  readonly eligibility: EligibilityRecord;
}

export const DESTINATIONS: readonly Destination[] = [
  {
    symbol: 'ONyc',
    name: 'ONyc',
    mainnetMint: '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5',
    decimals: 9,
    tokenProgram: 'token',
    yieldSource: 'Premiums paid to a reinsurance pool.',
    exitType: 'request',
    scopeFeedIndex: 350,
    defiLlamaPoolId: '7083d6a5-e3cb-4eeb-8204-f1b735e4ecbb',
    targetRateBps: 1_154,
    targetRateSource: 'ONre',
    eligibility: {
      mintIsNotPermissioned: true,
      routesAtBothSizes: true,
      hasAScopeFeed: true,
      exitTypeIsDocumented: true,
      yieldSourceIsOneSentence: true,
      checkedOn: '2026-09-14',
    },
  },
];

export function destinationForMint(mint: string): Destination | null {
  return DESTINATIONS.find((entry) => entry.mainnetMint === mint) ?? null;
}

export function destinationBySymbol(symbol: string): Destination | null {
  return DESTINATIONS.find((entry) => entry.symbol === symbol) ?? null;
}

// All five, every one required.
export function passesEveryEligibilityCheck(destination: Destination): boolean {
  const record = destination.eligibility;
  return (
    record.mintIsNotPermissioned &&
    record.routesAtBothSizes &&
    record.hasAScopeFeed &&
    record.exitTypeIsDocumented &&
    record.yieldSourceIsOneSentence
  );
}

export function shownDestinations(): readonly Destination[] {
  return DESTINATIONS.filter(passesEveryEligibilityCheck);
}
