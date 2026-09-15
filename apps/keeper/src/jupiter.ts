import type { RouteRequest, SwapInstructionFromTheRouter } from '@accrue/solana';

const RESTRICT_INTERMEDIATE_TOKENS = true;

/**
 * One quote and one swap instruction from the router. Nothing here decides anything about money:
 * the program computes its own floor from the oracle and refuses a fill under it.
 */
export async function fetchSwapInstruction(
  apiUrl: string,
  request: RouteRequest,
  apiKey: string | undefined,
): Promise<SwapInstructionFromTheRouter> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey !== undefined && apiKey !== '') {
    headers['x-api-key'] = apiKey;
  }

  const quoteUrl =
    `${apiUrl}/swap/v1/quote?inputMint=${request.inputMint}&outputMint=${request.outputMint}` +
    `&amount=${request.amountIn}&slippageBps=${request.slippageBps}` +
    `&restrictIntermediateTokens=${RESTRICT_INTERMEDIATE_TOKENS}&maxAccounts=${request.maxAccounts}`;

  const quoteResponse = await fetchJson(quoteUrl, { headers });
  if ((quoteResponse as { outAmount?: string }).outAmount === undefined) {
    throw new Error('the router returned no quote for this pair and size');
  }

  const swapResponse = (await fetchJson(`${apiUrl}/swap/v1/swap-instructions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: request.signingAuthority,
      wrapAndUnwrapSol: false,
      useSharedAccounts: false,
      skipUserAccountsRpcCalls: true,
    }),
  })) as { swapInstruction?: SwapInstructionFromTheRouter };

  const swapInstruction = swapResponse.swapInstruction;
  if (swapInstruction === undefined) {
    throw new Error('the router returned no swap instruction for this quote');
  }
  return swapInstruction;
}

async function fetchJson(url: string, options: RequestInit): Promise<unknown> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`the router answered ${response.status}`);
  }
  return response.json();
}
