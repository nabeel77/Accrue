import type { Address } from '@solana/kit';

export type ClusterName = 'mainnet' | 'devnet' | 'localnet';

// Everything that differs between clusters in one record.
export interface ClusterAddresses {
  readonly name: ClusterName;
  readonly kaminoLendingProgram: Address;
  readonly kaminoFarmsProgram: Address;
  readonly swapProgram: Address;
  readonly scopeProgram: Address;
  readonly scopePriceAccount: Address;
  readonly lendingMarket: Address;
  // One table of everything every position names, so a version 0 transaction fits.
  readonly lookupTable: Address | null;
  readonly mints: Readonly<Record<string, Address>>;
  readonly reserves: Readonly<Record<string, Address>>;
}
