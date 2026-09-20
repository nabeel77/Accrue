import { z } from 'zod';

import { isDevnet, optional, required } from '../../../../server/env.js';
import { callerAddress, withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, readBody, refuse, refuseWith, tooMany } from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

const THE_LARGEST_MOVE_THE_SANDBOX_TAKES = 90;

const body = z.union([
  z.object({ reset: z.literal(true) }),
  z.object({
    symbol: z.string().min(1).max(16),
    percent: z
      .number()
      .min(-THE_LARGEST_MOVE_THE_SANDBOX_TAKES)
      .max(THE_LARGEST_MOVE_THE_SANDBOX_TAKES),
  }),
]);

// The browser asks us, and we ask the price service with the shared secret. Devnet only, and
// nothing here touches a position: it moves what the sandbox oracle says a token is worth.
export async function POST(request: Request): Promise<Response> {
  if (!isDevnet()) {
    return refuse('There is no price service here.', 404);
  }
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuseWith('signInFirst', 401);
  }
  const parsed = await readBody(request, body);
  if ('response' in parsed) {
    return parsed.response;
  }

  const perWallet = await withinTheLimit('marketMove', 'devnet/prices/wallet', wallet);
  if (!perWallet.allowed) {
    return tooMany(perWallet.retryAfterSeconds);
  }
  const perHost = await withinTheLimit(
    'marketMove',
    'devnet/prices/host',
    callerAddress(request),
  );
  if (!perHost.allowed) {
    return tooMany(perHost.retryAfterSeconds);
  }

  const service = optional('DEVNET_PRICES_URL') ?? 'http://127.0.0.1:8788';
  const asked = 'reset' in parsed.value ? 'reset' : 'move';
  try {
    const answer = await fetch(`${service}/${asked}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-faucet-secret': required('DEVNET_FAUCET_SECRET'),
      },
      body: JSON.stringify(parsed.value),
    });
    if (!answer.ok) {
      return refuse('The price service could not move the market right now.', 502);
    }
    const moved = (await answer.json()) as {
      signature?: string;
      from?: number;
      to?: number;
    };
    return ok({
      moved: true,
      signature: moved.signature ?? null,
      from: moved.from ?? null,
      to: moved.to ?? null,
    });
  } catch {
    return refuse('The price service could not move the market right now.', 502);
  }
}
