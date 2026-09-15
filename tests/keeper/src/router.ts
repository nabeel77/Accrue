import { getBase64Decoder, type Address } from '@solana/kit';

import { rawAmountWorthRoundingDown, usdValueOfScaled } from '@accrue/core';
import {
  JUPITER_V6_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  type RouteRequest,
  type SwapInstructionFromTheRouter,
} from '@accrue/solana';

import type { AskTheRouter } from '../../../apps/keeper/src/guard.js';
import { DESTINATION_DECIMALS, ONYC_SCOPE_FEED_INDEX, type World } from './world.js';

/** The honest router fills at the oracle price. The hostile one is told which attack to try. */
export const ATTACK_HONEST_FILL = 5;

export interface RouterBehaviour {
  /** Absent for the honest router, which carries no mode byte at all. */
  readonly attack?: number;
  /** What the router really pays out, given the fair amount at the oracle price. */
  readonly pays?: (fair: bigint) => bigint;
  /** The account an attack tries to walk away with, appended to the route. */
  readonly wants?: Address;
}

interface SideOfTheTrade {
  readonly decimals: number;
  readonly priceScaled: bigint;
  readonly tokenProgram: Address;
}

function sideOfTheTrade(world: World, mint: Address): SideOfTheTrade {
  if (mint === world.borrow.snapshot.liquidityMint) {
    return {
      decimals: world.borrow.snapshot.liquidityMintDecimals,
      priceScaled: world.scopePriceScaled(world.borrow.snapshot.scopeFeedIndex),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    };
  }
  if (mint === world.destinationMint) {
    return {
      decimals: DESTINATION_DECIMALS,
      priceScaled: world.scopePriceScaled(ONYC_SCOPE_FEED_INDEX),
      tokenProgram: world.destinationTokenProgram,
    };
  }
  throw new Error('the test router was asked for a pair it does not hold');
}

export function fairFill(world: World, request: RouteRequest): bigint {
  const selling = sideOfTheTrade(world, request.inputMint);
  const buying = sideOfTheTrade(world, request.outputMint);
  return rawAmountWorthRoundingDown(
    usdValueOfScaled(request.amountIn, selling.decimals, selling.priceScaled),
    buying.decimals,
    buying.priceScaled,
  );
}

function littleEndian(value: bigint): number[] {
  const bytes: number[] = [];
  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    bytes.push(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  return bytes;
}

function routeData(
  behaviour: RouterBehaviour,
  amountIn: bigint,
  amountOut: bigint,
): string {
  const mode = behaviour.attack ?? null;
  const bytes = [
    ...(mode === null ? [] : [mode]),
    ...littleEndian(amountIn),
    ...littleEndian(amountOut),
  ];
  return getBase64Decoder().decode(new Uint8Array(bytes));
}

const WRITABLE = { isSigner: false, isWritable: true };
const READONLY = { isSigner: false, isWritable: false };

/**
 * Stands in for the swap API. It answers with the same shape the real one does, so the keeper's
 * own assembly turns it into remaining accounts exactly as it would in production.
 */
export function createTestRouter(
  world: World,
  behaviour: RouterBehaviour = {},
): AskTheRouter {
  const honest = world.routerIsHostile
    ? { ...behaviour, attack: behaviour.attack ?? ATTACK_HONEST_FILL }
    : behaviour;

  return async (request: RouteRequest): Promise<SwapInstructionFromTheRouter> => {
    const selling = sideOfTheTrade(world, request.inputMint);
    const buying = sideOfTheTrade(world, request.outputMint);
    const fair = fairFill(world, request);
    const paying = honest.pays === undefined ? fair : honest.pays(fair);

    const position = request.signingAuthority;
    const source = await world.tokenAccountOf(position, request.inputMint);
    const destination = await world.tokenAccountOf(position, request.outputMint);

    const accounts = [
      { pubkey: position, ...READONLY },
      { pubkey: source, ...WRITABLE },
      { pubkey: destination, ...WRITABLE },
      { pubkey: await world.swapVault(request.inputMint), ...WRITABLE },
      { pubkey: await world.swapVault(request.outputMint), ...WRITABLE },
      { pubkey: world.swapAuthority, ...READONLY },
      { pubkey: request.inputMint, ...READONLY },
      { pubkey: request.outputMint, ...READONLY },
      { pubkey: selling.tokenProgram, ...READONLY },
      { pubkey: buying.tokenProgram, ...READONLY },
    ];
    if (honest.wants !== undefined) {
      accounts.push({ pubkey: honest.wants, ...WRITABLE });
    }

    return {
      programId: JUPITER_V6_PROGRAM_ADDRESS,
      accounts,
      data: routeData(honest, request.amountIn, paying),
    };
  };
}
