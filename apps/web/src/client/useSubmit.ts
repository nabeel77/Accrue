'use client';

import { useCallback, useState } from 'react';

import { useSession } from './session.js';
import {
  failureOf,
  readFailure,
  readTheAnswer,
  SubmissionRefused,
  theWalletSaidNo,
  type ReadableFailure,
} from './failures.js';

export type SubmitState = 'idle' | 'signing' | 'pending' | 'confirmed' | 'failed';

const A_SECOND = 1_000;
const ATTEMPTS = 90;

export interface Submission {
  readonly state: SubmitState;
  readonly signature: string | null;
  readonly failure: ReadableFailure | null;
  run: (path: string, body?: Record<string, unknown>) => Promise<void>;
}

export function useSubmit(onDone?: () => void): Submission {
  const { signAndSubmit, headersForABuild } = useSession();
  const [state, setState] = useState<SubmitState>('idle');
  const [signature, setSignature] = useState<string | null>(null);
  const [failure, setFailure] = useState<ReadableFailure | null>(null);

  const run = useCallback(
    async (path: string, body?: Record<string, unknown>): Promise<void> => {
      setState('signing');
      setFailure(null);
      try {
        const built = await fetch(path, {
          method: 'POST',
          headers: headersForABuild(),
          body: JSON.stringify(body ?? {}),
        });
        const answer = await readTheAnswer<{
          buildId?: string;
          transaction?: readonly { transaction: string }[];
        }>(built);
        if (!built.ok || answer.transaction === undefined) {
          setFailure(readFailure(answer) ?? failureOf('somethingWentWrong'));
          setState('failed');
          return;
        }

        const sent = await signAndSubmit(
          answer.transaction.map((one) => one.transaction),
          answer.buildId,
        );
        setSignature(sent);
        setState('pending');

        for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
          const read = await fetch(
            `/api/positions/status?signature=${encodeURIComponent(sent)}`,
          );
          const status = await readTheAnswer<{ state?: string }>(read);
          if (status.state === 'confirmed') {
            setState('confirmed');
            onDone?.();
            return;
          }
          if (status.state === 'failed') {
            setFailure(failureOf('somethingWentWrong'));
            setState('failed');
            return;
          }
          await new Promise((wake) => setTimeout(wake, A_SECOND));
        }
        setFailure(failureOf('rpcTimeout'));
        setState('failed');
      } catch (thrown) {
        setFailure(failureFromTheWallet(thrown));
        setState('failed');
      }
    },
    [signAndSubmit, headersForABuild, onDone],
  );

  return { state, signature, failure, run };
}

function failureFromTheWallet(thrown: unknown): ReadableFailure {
  if (theWalletSaidNo(thrown)) {
    return failureOf('signatureRejected', thrown);
  }
  return thrown instanceof SubmissionRefused
    ? thrown.failure
    : failureOf('somethingWentWrong', thrown);
}
