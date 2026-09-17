import { isDevnet, optional, required } from '../../../../server/env.js';
import { callerAddress, withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, refuse, tooMany } from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

/**
 * The browser asks us, and we ask the faucet with the shared secret. The faucet address and the
 * secret never leave the server, and the wallet the tokens go to is the session's, never one the
 * caller names.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isDevnet()) {
    return refuse('There is no faucet here.', 404);
  }
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuse('Sign in first.', 401);
  }

  const perWallet = await withinTheLimit('read', 'devnet/faucet/wallet', wallet);
  if (!perWallet.allowed) {
    return tooMany(perWallet.retryAfterSeconds);
  }
  const perHost = await withinTheLimit(
    'read',
    'devnet/faucet/host',
    callerAddress(request),
  );
  if (!perHost.allowed) {
    return tooMany(perHost.retryAfterSeconds);
  }

  const faucetUrl = optional('DEVNET_FAUCET_URL') ?? 'http://127.0.0.1:8787/grant';
  try {
    const answer = await fetch(faucetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-faucet-secret': required('DEVNET_FAUCET_SECRET'),
      },
      body: JSON.stringify({ wallet }),
    });
    if (!answer.ok) {
      return refuse('The faucet could not send tokens right now.', 502);
    }
    const granted = (await answer.json()) as { signature?: string };
    return ok({ sent: true, signature: granted.signature ?? null });
  } catch {
    return refuse('The faucet could not send tokens right now.', 502);
  }
}
