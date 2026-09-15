import { getBase58Decoder, type Address } from '@solana/kit';

import type { OpenedPosition } from './positions.js';
import type { World } from './world.js';

const TOKEN_ACCOUNT_OWNER = 32;
const TOKEN_ACCOUNT_DELEGATE_TAG = 72;
const TOKEN_ACCOUNT_DELEGATE = 76;
const TOKEN_ACCOUNT_CLOSE_AUTHORITY_TAG = 129;
const TOKEN_ACCOUNT_CLOSE_AUTHORITY = 133;

interface TokenAccountAuthorities {
  readonly owner: Address;
  readonly delegate: Address | null;
  readonly closeAuthority: Address | null;
}

function addressAt(data: Uint8Array, offset: number): Address {
  return getBase58Decoder().decode(data.subarray(offset, offset + 32)) as Address;
}

function optionalAddressAt(data: Uint8Array, tag: number, value: number): Address | null {
  const present =
    (data[tag] ?? 0) | (data[tag + 1] ?? 0) | (data[tag + 2] ?? 0) | (data[tag + 3] ?? 0);
  return present === 0 ? null : addressAt(data, value);
}

function readAuthorities(world: World, tokenAccount: Address): TokenAccountAuthorities {
  const data = world.accountData(tokenAccount);
  return {
    owner: addressAt(data, TOKEN_ACCOUNT_OWNER),
    delegate: optionalAddressAt(data, TOKEN_ACCOUNT_DELEGATE_TAG, TOKEN_ACCOUNT_DELEGATE),
    closeAuthority: optionalAddressAt(
      data,
      TOKEN_ACCOUNT_CLOSE_AUTHORITY_TAG,
      TOKEN_ACCOUNT_CLOSE_AUTHORITY,
    ),
  };
}

export interface PositionState {
  readonly usdc: bigint;
  readonly destination: bigint;
  readonly collateral: bigint;
  readonly obligationCollateral: bigint;
  readonly obligationDebt: bigint;
  readonly positionLamports: bigint;
  readonly authorities: readonly TokenAccountAuthorities[];
}

/** Everything a route must leave exactly as it found it. */
export function readEverythingThatMustNotMove(
  world: World,
  opened: OpenedPosition,
): PositionState {
  const obligation = world.obligationIfItExists(opened.obligation);
  return {
    usdc: world.tokenBalance(opened.tokens.positionUsdc),
    destination: world.tokenBalance(opened.tokens.positionDestination),
    collateral: world.tokenBalance(opened.tokens.positionCollateral),
    obligationCollateral: obligation?.depositedAmountFor(world.collateral.address) ?? 0n,
    obligationDebt: obligation?.borrowedAmountScaledFor(world.borrow.address) ?? 0n,
    positionLamports: world.svm.getBalance(opened.address) ?? 0n,
    authorities: [
      readAuthorities(world, opened.tokens.positionCollateral),
      readAuthorities(world, opened.tokens.positionUsdc),
      readAuthorities(world, opened.tokens.positionDestination),
    ],
  };
}
