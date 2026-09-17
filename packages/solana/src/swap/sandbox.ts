import {
  AccountRole,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';

import type { RouteRequest, SwapRoute } from '../jupiter/route.js';
import { JUPITER_V6_PROGRAM_ADDRESS } from '../programIds.js';
import { decodeMintDecimals } from '../token.js';
import type { SwapRouter } from './router.js';

export const SANDBOX_POOL_SEED = 'pool';
export const SANDBOX_SWAP_AUTHORITY_SEED = 'swap';
export const SANDBOX_POOL_ACCOUNT_LENGTH = 185;

const POOL_MAGIC = 'swappool';
const OFFSET_SOURCE_VAULT = 104;
const OFFSET_DESTINATION_VAULT = 136;
const OFFSET_NUMERATOR = 168;
const OFFSET_DENOMINATOR = 176;

export interface SandboxPool {
  readonly sourceVault: Address;
  readonly destinationVault: Address;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function unsignedAt(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return value;
}

export function decodeSandboxPool(data: Uint8Array): SandboxPool {
  if (data.length < SANDBOX_POOL_ACCOUNT_LENGTH) {
    throw new Error('that account is not long enough to be a sandbox pool');
  }
  const magic = new TextDecoder().decode(data.subarray(0, 8));
  if (magic !== POOL_MAGIC) {
    throw new Error('that account does not carry the sandbox pool marker');
  }
  const decoder = getAddressDecoder();
  return {
    sourceVault: decoder.decode(
      data.subarray(OFFSET_SOURCE_VAULT, OFFSET_SOURCE_VAULT + 32),
    ),
    destinationVault: decoder.decode(
      data.subarray(OFFSET_DESTINATION_VAULT, OFFSET_DESTINATION_VAULT + 32),
    ),
    numerator: unsignedAt(data, OFFSET_NUMERATOR),
    denominator: unsignedAt(data, OFFSET_DENOMINATOR),
  };
}

export async function findSandboxPoolAddress(
  swapProgram: Address,
  inputMint: Address,
  outputMint: Address,
): Promise<Address> {
  const encoder = getAddressEncoder();
  const [pool] = await getProgramDerivedAddress({
    programAddress: swapProgram,
    seeds: [
      new TextEncoder().encode(SANDBOX_POOL_SEED),
      new Uint8Array(encoder.encode(inputMint)),
      new Uint8Array(encoder.encode(outputMint)),
    ],
  });
  return pool;
}

export async function findSandboxSwapAuthority(swapProgram: Address): Promise<Address> {
  const [authority] = await getProgramDerivedAddress({
    programAddress: swapProgram,
    seeds: [new TextEncoder().encode(SANDBOX_SWAP_AUTHORITY_SEED)],
  });
  return authority;
}

export interface SandboxRouterOptions {
  readonly rpc: Rpc<SolanaRpcApi>;
  readonly swapProgram?: Address;
}

interface MintReading {
  readonly decimals: number;
  readonly tokenProgram: Address;
}

async function readMint(rpc: Rpc<SolanaRpcApi>, mint: Address): Promise<MintReading> {
  const { value } = await rpc.getAccountInfo(mint, { encoding: 'base64' }).send();
  if (value === null) {
    throw new Error('the sandbox router was asked for a mint that does not exist');
  }
  return {
    decimals: decodeMintDecimals(Uint8Array.from(Buffer.from(value.data[0], 'base64'))),
    tokenProgram: value.owner,
  };
}

async function associatedTokenAccount(
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Address> {
  const encoder = getAddressEncoder();
  const [account] = await getProgramDerivedAddress({
    programAddress: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address,
    seeds: [
      new Uint8Array(encoder.encode(owner)),
      new Uint8Array(encoder.encode(tokenProgram)),
      new Uint8Array(encoder.encode(mint)),
    ],
  });
  return account;
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

/**
 * The sandbox pool holds one rate: how many whole output tokens one whole input token buys. The
 * fill is that rate applied to the size asked for, rounded down, which is the direction a real
 * router would round too.
 */
export function fillAtTheSandboxRate(
  amountIn: bigint,
  pool: SandboxPool,
  inputDecimals: number,
  outputDecimals: number,
): bigint {
  const scaledIn = amountIn * pool.numerator * 10n ** BigInt(outputDecimals);
  return scaledIn / (pool.denominator * 10n ** BigInt(inputDecimals));
}

/**
 * The sandbox router's whole instruction is the size in and the size out, so what it will pay can
 * be read straight back off the route. An owner instruction has to name its own floor, and this is
 * the honest one.
 */
export function sandboxRouteOutput(route: SwapRoute): bigint {
  if (route.data.length !== 16) {
    throw new Error('that route did not come from the sandbox router');
  }
  let value = 0n;
  for (let index = 15; index >= 8; index -= 1) {
    value = (value << 8n) | BigInt(route.data[index] ?? 0);
  }
  return value;
}

export function createSandboxRouter(options: SandboxRouterOptions): SwapRouter {
  const swapProgram = options.swapProgram ?? JUPITER_V6_PROGRAM_ADDRESS;

  return {
    name: 'sandbox',
    async findRoute(request: RouteRequest): Promise<SwapRoute> {
      const poolAddress = await findSandboxPoolAddress(
        swapProgram,
        request.inputMint,
        request.outputMint,
      );
      const { value: poolAccount } = await options.rpc
        .getAccountInfo(poolAddress, { encoding: 'base64' })
        .send();
      if (poolAccount === null) {
        throw new Error('the sandbox router holds no pool for this pair');
      }
      const pool = decodeSandboxPool(
        Uint8Array.from(Buffer.from(poolAccount.data[0], 'base64')),
      );

      const selling = await readMint(options.rpc, request.inputMint);
      const buying = await readMint(options.rpc, request.outputMint);
      const amountOut = fillAtTheSandboxRate(
        request.amountIn,
        pool,
        selling.decimals,
        buying.decimals,
      );
      if (amountOut === 0n) {
        throw new Error('the sandbox router would fill this size at nothing');
      }

      const authority = await findSandboxSwapAuthority(swapProgram);
      const source = await associatedTokenAccount(
        request.signingAuthority,
        request.inputMint,
        selling.tokenProgram,
      );
      const destination = await associatedTokenAccount(
        request.signingAuthority,
        request.outputMint,
        buying.tokenProgram,
      );

      return {
        accounts: [
          { address: request.signingAuthority, role: AccountRole.READONLY },
          { address: source, role: AccountRole.WRITABLE },
          { address: destination, role: AccountRole.WRITABLE },
          { address: pool.sourceVault, role: AccountRole.WRITABLE },
          { address: pool.destinationVault, role: AccountRole.WRITABLE },
          { address: authority, role: AccountRole.READONLY },
          { address: request.inputMint, role: AccountRole.READONLY },
          { address: request.outputMint, role: AccountRole.READONLY },
          { address: selling.tokenProgram, role: AccountRole.READONLY },
          { address: buying.tokenProgram, role: AccountRole.READONLY },
        ],
        data: new Uint8Array([
          ...littleEndian(request.amountIn),
          ...littleEndian(amountOut),
        ]),
        // The sandbox pool fills at its rate whatever the size, so there is no impact to report.
        quote: { amountOut, priceImpactBps: 0 },
      };
    },
  };
}
