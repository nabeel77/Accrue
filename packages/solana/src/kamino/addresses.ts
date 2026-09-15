import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';

import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  KAMINO_LENDING_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
} from '../programIds.js';
import type { ReserveSnapshot } from './layout.js';

const LENDING_MARKET_AUTHORITY_SEED = 'lma';
const USER_METADATA_SEED = 'user_meta';
const FARM_USER_STATE_SEED = 'user';

/** The obligation seeds carry two tags and two referrer slots, all empty for an ordinary loan. */
const NO_OBLIGATION_TAG = new Uint8Array([0]);
const NO_OBLIGATION_IDENTIFIER = new Uint8Array([0]);

const addresses = getAddressEncoder();

/** A seed the runtime hashes: the address's own thirty two bytes. */
function asSeed(value: Address): Uint8Array {
  return new Uint8Array(addresses.encode(value));
}

async function derive(
  programAddress: Address,
  seeds: (Uint8Array | string)[],
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds });
  return derived;
}

/**
 * The one address the lending market signs its own transfers with. Every instruction that moves a
 * token into or out of a reserve carries it, and the market derives and checks it again itself.
 */
export function findLendingMarketAuthority(lendingMarket: Address): Promise<Address> {
  return derive(KAMINO_LENDING_PROGRAM_ADDRESS, [
    LENDING_MARKET_AUTHORITY_SEED,
    asSeed(lendingMarket),
  ]);
}

/** The loan account a position owns, one per position per market. */
export function findKaminoObligation(input: {
  readonly owner: Address;
  readonly lendingMarket: Address;
}): Promise<Address> {
  return derive(KAMINO_LENDING_PROGRAM_ADDRESS, [
    NO_OBLIGATION_TAG,
    NO_OBLIGATION_IDENTIFIER,
    asSeed(input.owner),
    asSeed(input.lendingMarket),
    asSeed(SYSTEM_PROGRAM_ADDRESS),
    asSeed(SYSTEM_PROGRAM_ADDRESS),
  ]);
}

/** The record the lending market keeps for anyone who holds an obligation. */
export function findKaminoUserMetadata(owner: Address): Promise<Address> {
  return derive(KAMINO_LENDING_PROGRAM_ADDRESS, [USER_METADATA_SEED, asSeed(owner)]);
}

/**
 * A position's stake in one reserve's farm. Every borrow, repay, deposit and withdraw on a reserve
 * that names a farm has to carry it, or the lending market refuses the call.
 */
export function findObligationFarmUserState(input: {
  readonly reserveFarmState: Address;
  readonly obligation: Address;
}): Promise<Address> {
  return derive(KAMINO_FARMS_PROGRAM_ADDRESS, [
    FARM_USER_STATE_SEED,
    asSeed(input.reserveFarmState),
    asSeed(input.obligation),
  ]);
}

export interface TokenAccountAddress {
  readonly mint: Address;
  readonly tokenProgram: Address;
}

export function findAssociatedTokenAccount(
  input: TokenAccountAddress & { readonly owner: Address },
): Promise<Address> {
  return derive(ASSOCIATED_TOKEN_PROGRAM_ADDRESS, [
    asSeed(input.owner),
    asSeed(input.tokenProgram),
    asSeed(input.mint),
  ]);
}

export interface ThreeTokenAccounts {
  readonly collateral: Address;
  readonly usdc: Address;
  readonly destination: Address;
}

export interface ThreeMints {
  readonly collateral: TokenAccountAddress;
  readonly usdc: TokenAccountAddress;
  readonly destination: TokenAccountAddress;
}

/**
 * The three token accounts one wallet holds for a strategy. The position holds one set and the
 * owner holds the set every token ends up in, so `leave` and `unwind` need both.
 */
export async function findTheThreeTokenAccounts(
  owner: Address,
  mints: ThreeMints,
): Promise<ThreeTokenAccounts> {
  const [collateral, usdc, destination] = await Promise.all([
    findAssociatedTokenAccount({ owner, ...mints.collateral }),
    findAssociatedTokenAccount({ owner, ...mints.usdc }),
    findAssociatedTokenAccount({ owner, ...mints.destination }),
  ]);
  return { collateral, usdc, destination };
}

export interface ReserveAccounts {
  readonly liquiditySupply: Address;
  readonly liquidityFeeReceiver: Address;
  readonly collateralMint: Address;
  readonly collateralSupply: Address;
  readonly liquidityTokenProgram: Address;
}

/**
 * The vaults a reserve names for itself. These are never derived, they are read from the reserve,
 * because the market is free to point a reserve at any account it likes.
 */
export function reserveAccounts(reserve: ReserveSnapshot): ReserveAccounts {
  return {
    liquiditySupply: reserve.liquiditySupplyVault,
    liquidityFeeReceiver: reserve.liquidityFeeVault,
    collateralMint: reserve.collateralMint,
    collateralSupply: reserve.collateralSupplyVault,
    liquidityTokenProgram: reserve.liquidityTokenProgram,
  };
}
