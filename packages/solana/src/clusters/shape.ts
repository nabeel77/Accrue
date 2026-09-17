import type { Address } from '@solana/kit';

export type ClusterName = 'mainnet' | 'devnet' | 'localnet';

/**
 * Everything that differs between clusters in one record. The program has the same list in
 * `clusters/`, and the devnet file on both sides is generated from what the sandbox deployed.
 */
export interface ClusterAddresses {
  readonly name: ClusterName;
  readonly kaminoLendingProgram: Address;
  readonly kaminoFarmsProgram: Address;
  readonly swapProgram: Address;
  readonly scopeProgram: Address;
  readonly scopePriceAccount: Address;
  readonly lendingMarket: Address;
  readonly mints: Readonly<Record<string, Address>>;
  readonly reserves: Readonly<Record<string, Address>>;
}
