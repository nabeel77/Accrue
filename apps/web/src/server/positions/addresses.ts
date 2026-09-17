import 'server-only';

import { getProgramDerivedAddress, getAddressEncoder, type Address } from '@solana/kit';

import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, currentCluster } from '@accrue/solana';
import { findKaminoObligation } from '@accrue/solana/kamino';
import { findPositionPda } from '@accrue/solana/program';

import type { PositionAddresses } from './shape.js';

const encoder = getAddressEncoder();

export async function associatedTokenAccount(
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Address> {
  const [account] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      new Uint8Array(encoder.encode(owner)),
      new Uint8Array(encoder.encode(tokenProgram)),
      new Uint8Array(encoder.encode(mint)),
    ],
  });
  return account;
}

export interface AddressInputs {
  readonly owner: Address;
  readonly collateralMint: Address;
  readonly collateralTokenProgram: Address;
  readonly borrowMint: Address;
  readonly borrowTokenProgram: Address;
  readonly destinationMint: Address;
  readonly destinationTokenProgram: Address;
}

export async function positionAddresses(
  inputs: AddressInputs,
): Promise<PositionAddresses> {
  const [position] = await findPositionPda({
    owner: inputs.owner,
    collateralMint: inputs.collateralMint,
    destinationMint: inputs.destinationMint,
  });
  return {
    position,
    obligation: await findKaminoObligation({
      owner: position,
      lendingMarket: currentCluster().lendingMarket,
    }),
    ownerCollateral: await associatedTokenAccount(
      inputs.owner,
      inputs.collateralMint,
      inputs.collateralTokenProgram,
    ),
    ownerUsdc: await associatedTokenAccount(
      inputs.owner,
      inputs.borrowMint,
      inputs.borrowTokenProgram,
    ),
    ownerDestination: await associatedTokenAccount(
      inputs.owner,
      inputs.destinationMint,
      inputs.destinationTokenProgram,
    ),
    positionCollateral: await associatedTokenAccount(
      position,
      inputs.collateralMint,
      inputs.collateralTokenProgram,
    ),
    positionUsdc: await associatedTokenAccount(
      position,
      inputs.borrowMint,
      inputs.borrowTokenProgram,
    ),
    positionDestination: await associatedTokenAccount(
      position,
      inputs.destinationMint,
      inputs.destinationTokenProgram,
    ),
  };
}
