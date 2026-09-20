import { isDevnet, optional, required } from '../../../../server/env.js';
import { callerAddress, withinTheLimit } from '../../../../server/rateLimit.js';
import { ok, refuse, refuseWith, tooMany } from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';

const LAMPORTS_IN_A_SOL = 1_000_000_000;

function theSolIn(lamports: string | undefined): string | null {
  if (lamports === undefined || lamports === '' || lamports === '0') {
    return null;
  }
  const sol = Number(lamports) / LAMPORTS_IN_A_SOL;
  return Number.isFinite(sol) && sol > 0 ? sol.toFixed(2) : null;
}

// The browser asks us, and we ask the faucet with the shared secret.
export async function POST(request: Request): Promise<Response> {
  if (!isDevnet()) {
    return refuse('There is no faucet here.', 404);
  }
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return refuseWith('signInFirst', 401);
  }

  const perWallet = await withinTheLimit('faucet', 'devnet/faucet/wallet', wallet);
  if (!perWallet.allowed) {
    return tooMany(perWallet.retryAfterSeconds);
  }
  const perHost = await withinTheLimit(
    'faucet',
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
    const granted = (await answer.json()) as {
      signature?: string;
      grants?: { symbol?: string; amount?: string }[];
      lamportsSent?: string;
    };
    return ok({
      sent: true,
      signature: granted.signature ?? null,
      grants: (granted.grants ?? []).flatMap((grant) =>
        typeof grant.symbol === 'string' && typeof grant.amount === 'string'
          ? [{ symbol: grant.symbol, amount: grant.amount }]
          : [],
      ),
      solSent: theSolIn(granted.lamportsSent),
    });
  } catch {
    return refuse('The faucet could not send tokens right now.', 502);
  }
}
