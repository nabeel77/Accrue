import {
  CURRENT_RISK_ACKNOWLEDGEMENT_VERSION,
  CURRENT_TERMS_VERSION,
  RISK_ACKNOWLEDGEMENT_BUTTON,
  RISK_ACKNOWLEDGEMENT_SENTENCES,
  RISK_ACKNOWLEDGEMENT_TITLE,
  TERMS_SUMMARY,
  TERMS_TITLE,
} from '@accrue/core';

import { isDevnet } from '../../../server/env.js';
import { standingOf } from '../../../server/gates.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';

export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  if (wallet === null) {
    return ok({
      signedIn: false,
      cluster: isDevnet() ? 'devnet' : 'mainnet',
      terms: {
        version: CURRENT_TERMS_VERSION,
        title: TERMS_TITLE,
        summary: TERMS_SUMMARY,
      },
    });
  }

  const limit = await withinTheLimit('read', 'me', wallet);
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }

  const standing = await standingOf(wallet);
  return ok({
    signedIn: true,
    wallet,
    cluster: isDevnet() ? 'devnet' : 'mainnet',
    terms: {
      version: CURRENT_TERMS_VERSION,
      accepted: standing.termsAccepted,
      title: TERMS_TITLE,
      summary: TERMS_SUMMARY,
    },
    acknowledgement: {
      version: CURRENT_RISK_ACKNOWLEDGEMENT_VERSION,
      accepted: standing.risksAcknowledged,
      title: RISK_ACKNOWLEDGEMENT_TITLE,
      sentences: RISK_ACKNOWLEDGEMENT_SENTENCES,
      button: RISK_ACKNOWLEDGEMENT_BUTTON,
    },
  });
}
