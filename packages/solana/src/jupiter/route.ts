import {
  address,
  AccountRole,
  getBase64Encoder,
  type AccountMeta,
  type Address,
} from '@solana/kit';

import { JUPITER_V6_PROGRAM_ADDRESS } from '../programIds.js';

// What we ask the swap API for: one size, one pair, one account budget.
export interface RouteRequest {
  readonly inputMint: Address;
  readonly outputMint: Address;
  readonly amountIn: bigint;
  readonly slippageBps: number;
  readonly maxAccounts: number;
  readonly signingAuthority: Address;
}

// The shape the swap API answers `POST /swap/v1/swap-instructions` with.
export interface SwapInstructionFromTheRouter {
  readonly programId: string;
  readonly accounts: readonly {
    readonly pubkey: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
  }[];
  readonly data: string;
}

// What the router says it will pay and what it will cost to get there.
export interface RouteQuote {
  readonly amountOut: bigint;
  readonly priceImpactBps: number;
}

export interface SwapRoute {
  readonly accounts: AccountMeta[];
  readonly data: Uint8Array;
  readonly quote: RouteQuote;
  // What the program is told to accept.
  readonly minimumAmountOut: bigint;
}

export function routeFromSwapInstruction(
  instruction: SwapInstructionFromTheRouter,
  quote: RouteQuote = { amountOut: 0n, priceImpactBps: 0 },
  minimumAmountOut = quote.amountOut,
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
    quote,
    minimumAmountOut,
  };
}
