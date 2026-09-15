import {
  address,
  AccountRole,
  getBase64Encoder,
  type AccountMeta,
  type Address,
} from '@solana/kit';

import { JUPITER_V6_PROGRAM_ADDRESS } from '../programIds.js';

/** What we ask the swap API for: one size, one pair, one account budget. */
export interface RouteRequest {
  readonly inputMint: Address;
  readonly outputMint: Address;
  readonly amountIn: bigint;
  readonly slippageBps: number;
  readonly maxAccounts: number;
  readonly signingAuthority: Address;
}

/** The shape the swap API answers `POST /swap/v1/swap-instructions` with. */
export interface SwapInstructionFromTheRouter {
  readonly programId: string;
  readonly accounts: readonly {
    readonly pubkey: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
  }[];
  readonly data: string;
}

export interface SwapRoute {
  readonly accounts: AccountMeta[];
  readonly data: Uint8Array;
}

/**
 * Turns the router's own swap instruction into the remaining accounts and the raw data our
 * instruction carries. No account keeps a signature: the program rewrites every role itself, and
 * the position is the only address that ever signs a route, through its own seeds.
 */
export function routeFromSwapInstruction(
  instruction: SwapInstructionFromTheRouter,
): SwapRoute {
  if (address(instruction.programId) !== JUPITER_V6_PROGRAM_ADDRESS) {
    throw new Error('that swap instruction is not for the router the program calls');
  }

  return {
    accounts: instruction.accounts.map((account) => ({
      address: address(account.pubkey),
      role: account.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
    })),
    data: new Uint8Array(getBase64Encoder().encode(instruction.data)),
  };
}
