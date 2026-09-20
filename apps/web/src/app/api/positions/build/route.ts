import { isAddress } from '@solana/kit';
import { z } from 'zod';

import { shortenEveryAddress } from '@accrue/core';

import { recordInTheAuditLog } from '../../../../server/gates.js';
import { destinationFor } from '../../../../server/markets.js';
import { buildOpenPosition } from '../../../../server/positions/buildOpenPosition.js';
import { recordTheBuild } from '../../../../server/positions/record.js';
import { TheChainRefusedIt } from '../../../../server/positions/assemble.js';
import { whileTheCallerIsKnown } from '../../../../server/positions/theCaller.js';
import { WALLET_TAKES_VERSION_ONE_HEADER } from '../../../../walletVersions.js';
import {
  everyReason,
  whyTheChainRefused,
} from '../../../../server/positions/whyTheChainRefused.js';
import {
  stepTimer,
  TheBuildTookTooLong,
  withinTheDeadline,
} from '../../../../server/positions/steps.js';
import { withinTheLimit } from '../../../../server/rateLimit.js';
import {
  ok,
  readBody,
  refuseWith,
  somethingWentWrong,
  tooMany,
} from '../../../../server/respond.js';
import { walletOfTheSession } from '../../../../server/session.js';
import { latestDestinationTarget } from '../../../../server/snapshots.js';

const body = z.object({
  stockMint: z.string().refine(isAddress),
  destinationSymbol: z.string().min(1).max(16),
  collateralAmountRaw: z.string().regex(/^\d{1,20}$/u),
  targetLtvBps: z.number().int().min(1).max(9_000).optional(),
  protectLtvBps: z.number().int().min(1).max(9_500).optional(),
  growEnabled: z.boolean().optional(),
  exitOnFlagEnabled: z.boolean().optional(),
  overrideAccepted: z.boolean().optional(),
});

// Which refusals the audit log keeps apart, by the name the builder gave them.
const AUDIT_ACTIONS: Record<
  string,
  | 'build_refused_terms'
  | 'build_refused_acknowledgement'
  | 'build_refused_liquidity'
  | 'build_refused_cap'
> = {
  terms: 'build_refused_terms',
  acknowledgement: 'build_refused_acknowledgement',
  aboveTheLiquidityShare: 'build_refused_liquidity',
  positionTooSmall: 'build_refused_cap',
  positionTooLarge: 'build_refused_cap',
  aboveTheDefaultLoanToValue: 'build_refused_cap',
};

function auditActionFor(
  refusal: string,
):
  | 'build_refused_terms'
  | 'build_refused_acknowledgement'
  | 'build_refused_liquidity'
  | 'build_refused_cap'
  | 'build_refused_strategy' {
  return AUDIT_ACTIONS[refusal] ?? 'build_refused_strategy';
}

const REFUSAL_STATUS: Record<string, number> = {
  terms: 403,
  acknowledgement: 403,
  paused: 503,
  programPaused: 503,
  cap: 409,
  liquidity: 409,
  strategy: 409,
  shortfall: 409,
  staleOracle: 409,
  noRoute: 409,
  capExhausted: 409,
};

export async function POST(request: Request): Promise<Response> {
  const steps = stepTimer();
  try {
    const wallet = await walletOfTheSession();
    if (wallet === null) {
      return refuseWith('signInFirst', 401);
    }
    const limit = await withinTheLimit('build', 'positions/build', wallet);
    if (!limit.allowed) {
      return tooMany(limit.retryAfterSeconds);
    }
    const parsed = await readBody(request, body);
    if ('response' in parsed) {
      return parsed.response;
    }

    const destination = destinationFor(parsed.value.destinationSymbol);
    const target = await steps.at('reading the yield token', () =>
      latestDestinationTarget(destination),
    );
    const outcome = await whileTheCallerIsKnown(
      request.headers.get(WALLET_TAKES_VERSION_ONE_HEADER) === 'true',
      () =>
        withinTheDeadline(steps, () =>
          steps.at('building the open', () =>
            buildOpenPosition({ wallet, ...parsed.value }, destination, target.rateBps),
          ),
        ),
    );

    if ('refused' in outcome) {
      await recordInTheAuditLog(wallet, auditActionFor(outcome.refused.refusal), {
        ...outcome.refused.detail,
      });
      return ok(outcome.refused, REFUSAL_STATUS[outcome.refused.refusal] ?? 409);
    }

    return ok({
      buildId: await recordTheBuild({
        wallet,
        positionId: outcome.positionId,
        kind: 'open',
        built: outcome.built,
      }),
      transaction: outcome.built,
      summary: outcome.summary,
      targetRateSource: target.source,
      steps: steps.taken(),
    });
  } catch (failure) {
    if (failure instanceof TheBuildTookTooLong) {
      console.error(`a build gave up while ${failure.step}`);
      return refuseWith('rpcTimeout', 504, { steps: steps.taken() });
    }
    if (failure instanceof TheChainRefusedIt) {
      const why = shortenEveryAddress(failure.lastLogLines);
      console.error(`a simulation refused a build: ${why}`);
      return refuseWith(
        'simulationFailed',
        409,
        process.env.NODE_ENV === 'production' ? {} : { because: why },
      );
    }
    const why = whyTheChainRefused(failure);
    if (why !== null) {
      console.error(`a build did not finish: ${everyReason(failure)}`);
      return refuseWith(why, 409);
    }
    return somethingWentWrong(failure);
  }
}
