import { address, getAddressEncoder } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';

import { JUPITER_V6_PROGRAM_ADDRESS } from '../programIds.js';
import { createJupiterRouter } from './jupiter.js';
import {
  createSandboxRouter,
  SANDBOX_POOL_ACCOUNT_LENGTH,
  sandboxRouteOutput,
} from './sandbox.js';

const ONE_HUNDRED_USDC = 100_000_000n;
const A_POOL_ACCOUNT = 'So11111111111111111111111111111111111111112';

function aSwapInstruction(): unknown {
  return {
    programId: JUPITER_V6_PROGRAM_ADDRESS,
    accounts: [{ pubkey: A_POOL_ACCOUNT, isSigner: false, isWritable: true }],
    data: 'AAAA',
  };
}

function answerWith(quote: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn((input: unknown) => {
    const url = String(input);
    const body = url.includes('/quote') ? quote : { swapInstruction: aSwapInstruction() };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

const request = {
  inputMint: address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  outputMint: address('5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5'),
  amountIn: ONE_HUNDRED_USDC,
  slippageBps: 50,
  maxAccounts: 28,
  signingAuthority: address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'),
};

describe('the minimum the program is told to accept', () => {
  it('comes from the router own threshold when it gives one', async () => {
    vi.stubGlobal(
      'fetch',
      answerWith({
        outAmount: '990000000',
        otherAmountThreshold: '985050000',
        priceImpactPct: '0.001',
      }),
    );
    const route = await createJupiterRouter({
      apiUrl: 'https://example.invalid',
    }).findRoute(request);
    expect(route.quote.amountOut).toBe(990_000_000n);
    expect(route.minimumAmountOut).toBe(985_050_000n);
    expect(route.minimumAmountOut).toBeLessThan(route.quote.amountOut);
    vi.unstubAllGlobals();
  });

  it('falls back to the quote less the slippage asked for', async () => {
    vi.stubGlobal('fetch', answerWith({ outAmount: '1000000000', priceImpactPct: '0' }));
    const route = await createJupiterRouter({
      apiUrl: 'https://example.invalid',
    }).findRoute(request);
    expect(route.quote.amountOut).toBe(1_000_000_000n);
    expect(route.minimumAmountOut).toBe(995_000_000n);
    vi.unstubAllGlobals();
  });

  it('holds the slippage ceiling down when the caller asks for more', async () => {
    vi.stubGlobal('fetch', answerWith({ outAmount: '1000000000', priceImpactPct: '0' }));
    const route = await createJupiterRouter({
      apiUrl: 'https://example.invalid',
      maxSlippageBps: 10,
    }).findRoute({ ...request, slippageBps: 500 });
    expect(route.minimumAmountOut).toBe(999_000_000n);
    vi.unstubAllGlobals();
  });
});

const A_MINT = address('BUxHx9ydngE2JjZaCi6NYBPdpLtewo3NVsbq9DBpHjpy');
const ANOTHER_MINT = address('7aEvt3TXHMEDHfYTguxRbCfxW6XVbBE6rQVqu33h4YnN');
const A_VAULT = address('DhVcaWL7BxtYq2dTpujo1ChX9HSN3qpx3aved1Ns6mcv');

function aPoolAccount(numerator: bigint, denominator: bigint): string {
  const data = new Uint8Array(SANDBOX_POOL_ACCOUNT_LENGTH);
  data.set(new TextEncoder().encode('swappool'), 0);
  const vault = new Uint8Array(getAddressEncoder().encode(A_VAULT));
  data.set(vault, 104);
  data.set(vault, 136);
  for (let index = 0; index < 8; index += 1) {
    data[168 + index] = Number((numerator >> BigInt(index * 8)) & 0xffn);
    data[176 + index] = Number((denominator >> BigInt(index * 8)) & 0xffn);
  }
  return Buffer.from(data).toString('base64');
}

function aMintAccount(decimals: number): string {
  const data = new Uint8Array(82);
  data[44] = decimals;
  return Buffer.from(data).toString('base64');
}

function aSandboxRpc(): Parameters<typeof createSandboxRouter>[0]['rpc'] {
  const pool = aPoolAccount(1n, 1n);
  return {
    getAccountInfo(requested: unknown) {
      const asText = String(requested);
      const data = asText === A_MINT || asText === ANOTHER_MINT ? aMintAccount(6) : pool;
      return {
        send: () =>
          Promise.resolve({
            value: {
              data: [data, 'base64'],
              owner: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            },
          }),
      };
    },
  } as never;
}

describe('the sandbox router', () => {
  it('names a minimum under its own fill by the slippage asked for', async () => {
    const router = createSandboxRouter({ rpc: aSandboxRpc() });
    const route = await router.findRoute({
      inputMint: A_MINT,
      outputMint: ANOTHER_MINT,
      amountIn: 1_000_000n,
      slippageBps: 100,
      maxAccounts: 28,
      signingAuthority: address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'),
    });

    expect(route.quote.amountOut).toBe(1_000_000n);
    expect(sandboxRouteOutput(route)).toBe(1_000_000n);
    expect(route.minimumAmountOut).toBe(990_000n);
  });
});
