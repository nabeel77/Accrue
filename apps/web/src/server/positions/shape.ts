import 'server-only';

import type { Address } from '@solana/kit';

// Everything a build route answers with, in one shape, so nothing leaks a database row.
export interface BuiltTransaction {
  // Base64, version 1, already simulated.
  readonly transaction: string;
  readonly version: 0 | 1;
  readonly bytes: number;
  readonly uniqueAddresses: number;
  readonly computeUnits: string | null;
  // The last block height the blockhash is good for, which is when the build is dead.
  readonly blockhashExpiresAtHeight: string;
}

export interface BuildRefusal {
  readonly refusal:
    | 'terms'
    | 'acknowledgement'
    | 'paused'
    | 'programPaused'
    | 'cap'
    | 'liquidity'
    | 'strategy'
    | 'shortfall'
    | 'staleOracle'
    | 'noRoute'
    | 'capExhausted'
    | 'stockNotOffered'
    | 'pairNotOnThisNetwork'
    | 'aboveTheMarketMaximum'
    | 'positionAlreadyOpen'
    | 'nothingToSell'
    | 'notEnoughStock'
    | 'guardLevelsOutOfBounds'
    | 'noLoanToGuard'
    | 'positionTooSmall'
    | 'positionTooLarge'
    | 'aboveTheDefaultLoanToValue'
    | 'aboveTheLiquidityShare';
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
