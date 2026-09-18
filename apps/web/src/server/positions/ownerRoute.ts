import 'server-only';

import { address } from '@solana/kit';
import { headers } from 'next/headers';
import type { NextResponse } from 'next/server';

import { shortenEveryAddress } from '@accrue/core';

import { withinTheLimit } from '../rateLimit.js';
import { ok, refuseWith, somethingWentWrong, tooMany } from '../respond.js';
import { walletOfTheSession } from '../session.js';
import { positionForTheOwner, type StoredPosition } from './list.js';
import type { OwnerActionInputs, OwnerActionOutcome } from './buildOwnerAction.js';
import type { BuiltTransaction } from './shape.js';
import { recordTheOwnerBuild } from './record.js';
import { TheChainRefusedIt } from './assemble.js';
import { ThePositionIsGone } from './ownerWorld.js';
import { whileTheCallerIsKnown } from './theCaller.js';
import { everyReason, whyTheChainRefused } from './whyTheChainRefused.js';
import { WALLET_TAKES_VERSION_ONE_HEADER } from '../../walletVersions.js';
import {
  stepTimer,
  TheBuildTookTooLong,
  withinTheDeadline,
  type StepTimer,
} from './steps.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// positions/top-up/build becomes top-up, which is what the activity screen reads.
function theKindOf(limitKey: string): string {
  return limitKey.split('/')[1] ?? 'owner';
}

// A position opened outside this app has no row of ours, and its build is still ours to send.
function rowIdOf(stored: StoredPosition): string | null {
  return UUID.test(stored.id) ? stored.id : null;
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

export interface OwnerRouteContext {
  readonly wallet: string;
  readonly stored: StoredPosition;
  readonly inputs: OwnerActionInputs;
  readonly steps: StepTimer;
}

export type OwnerRouteOutcome =
  | OwnerActionOutcome
  | {
      readonly built: readonly BuiltTransaction[];
      readonly extra: Record<string, unknown>;
    };

export async function answerAnOwnerAction(
  limitKey: string,
  id: string,
  build: (context: OwnerRouteContext) => Promise<OwnerRouteOutcome>,
): Promise<NextResponse> {
  const steps = stepTimer();
  try {
    const wallet = await walletOfTheSession();
    if (wallet === null) {
      return refuseWith('signInFirst', 401);
    }
    const limit = await withinTheLimit('build', limitKey, wallet);
    if (!limit.allowed) {
      return tooMany(limit.retryAfterSeconds);
    }

    const stored = await positionForTheOwner(wallet, id);
    if (stored?.positionAddress == null) {
      return refuseWith('notYours', 404);
    }

    const takesVersionOne =
      (await headers()).get(WALLET_TAKES_VERSION_ONE_HEADER) === 'true';
    const outcome = await whileTheCallerIsKnown(takesVersionOne, () =>
      withinTheDeadline(steps, () =>
        build({
          wallet,
          stored,
          steps,
          inputs: {
            owner: address(wallet),
            collateralMint: address(stored.collateralMint),
            destinationMint: address(stored.destinationMint),
          },
        }),
      ),
    );
    if ('refused' in outcome) {
      console.error(
        shortenEveryAddress(
          `an owner action was refused: ${outcome.refused.message} ${JSON.stringify(outcome.refused.detail ?? {})}`,
        ),
      );
      return ok(outcome.refused, REFUSAL_STATUS[outcome.refused.refusal] ?? 409);
    }
    return ok({
      buildId: await recordTheOwnerBuild(
        wallet,
        rowIdOf(stored),
        outcome.built,
        theKindOf(limitKey),
      ),
      transaction: outcome.built,
      steps: steps.taken(),
      ...('extra' in outcome ? outcome.extra : {}),
    });
  } catch (failure) {
    if (failure instanceof TheBuildTookTooLong) {
      console.error(`a build gave up while ${failure.step}`);
      return refuseWith('rpcTimeout', 504, { steps: steps.taken() });
    }
    if (failure instanceof ThePositionIsGone) {
      console.error('an owner action named a position that is not on the chain');
      return refuseWith('positionGone', 409);
    }
    if (failure instanceof TheChainRefusedIt) {
      const why = shortenEveryAddress(failure.lastLogLines);
      console.error(`a simulation refused a build: ${why}`);
      // In development the chain's own words ride along, so the console says what the sentence
      // on the screen cannot. A deployment sends the sentence alone.
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
