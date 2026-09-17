import 'server-only';

import type { Address } from '@solana/kit';

/** Everything a build route answers with, in one shape, so nothing leaks a database row. */
export interface BuiltTransaction {
  /** Base64, version 1, already simulated. A failed simulation is never returned. */
  readonly transaction: string;
  readonly version: 1;
  readonly bytes: number;
  readonly uniqueAddresses: number;
  readonly computeUnits: string | null;
  readonly blockhashExpiresAtSlot: string;
}

export interface BuildRefusal {
  readonly refusal:
    | 'terms'
    | 'acknowledgement'
    | 'paused'
    | 'cap'
    | 'liquidity'
    | 'strategy'
    | 'shortfall';
  readonly message: string;
  readonly detail?: Record<string, string | number>;
}

export interface PositionAddresses {
  readonly position: Address;
  readonly obligation: Address;
  readonly ownerCollateral: Address;
  readonly ownerUsdc: Address;
  readonly ownerDestination: Address;
  readonly positionCollateral: Address;
  readonly positionUsdc: Address;
  readonly positionDestination: Address;
}
