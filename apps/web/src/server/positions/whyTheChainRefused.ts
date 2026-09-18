import { shortenEveryAddress } from '@accrue/core';

import type { FailureCode } from '../../copy/errors.js';

// What the chain says when it will not take a transaction, and which sentence that is.
const WHAT_THE_CHAIN_SAYS: readonly {
  readonly said: string;
  readonly code: FailureCode;
}[] = [
  { said: 'blockhash not found', code: 'buildExpired' },
  { said: 'blockhashnotfound', code: 'buildExpired' },
  { said: 'block height exceeded', code: 'buildExpired' },
  { said: 'pricetooold', code: 'staleOracle' },
  { said: 'price too old', code: 'staleOracle' },
  { said: 'oraclepriceisstale', code: 'staleOracle' },
  { said: 'priceisstale', code: 'staleOracle' },
  { said: 'stale', code: 'staleOracle' },
  // Kit says this when an account it was told to read is not there at all.
  { said: 'account not found', code: 'accountMissing' },
  { said: 'accountnotfound', code: 'accountMissing' },
];

// A send that failed preflight is the chain refusing it, which is not the same as our own fault.
const REFUSED_IT_OUTRIGHT = [
  'simulation failed',
  'custom program error',
  'insufficient funds',
  'preflight',
  'transaction error',
];

export function everyReason(failure: unknown): string {
  const reasons: string[] = [];
  let current: unknown = failure;
  while (current instanceof Error && reasons.length < 5) {
    reasons.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  // An rpc failure carries the chain's own logs beside the message, and that is where the
  // program's error name is.
  if (typeof failure === 'object' && failure !== null && 'context' in failure) {
    reasons.push(JSON.stringify(failure.context));
  }
  return shortenEveryAddress(reasons.join(' <- '));
}

export function whyTheChainRefused(failure: unknown): FailureCode | null {
  const said = everyReason(failure).toLowerCase();
  for (const known of WHAT_THE_CHAIN_SAYS) {
    if (said.includes(known.said)) {
      return known.code;
    }
  }
  return REFUSED_IT_OUTRIGHT.some((phrase) => said.includes(phrase))
    ? 'simulationFailed'
    : null;
}
