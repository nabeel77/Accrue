'use client';

import type { JSX } from 'react';

import { COMMON } from '../../copy/common.js';
import { Mono } from './primitives.js';

const SOLSCAN_TRANSACTION = 'https://solscan.io/tx/';
const SHORTENED = 4;

export function transactionUrl(signature: string, cluster: 'devnet' | 'mainnet'): string {
  return `${SOLSCAN_TRANSACTION}${signature}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

export function TransactionLink({
  signature,
  cluster,
  testId,
}: {
  signature: string;
  cluster: 'devnet' | 'mainnet';
  testId?: string;
}): JSX.Element {
  return (
    <a
      href={transactionUrl(signature, cluster)}
      target="_blank"
      rel="noreferrer noopener"
      data-testid={testId}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      <span>{COMMON.checkTheTransaction}</span>
      <Mono tone="accent">
        {signature.slice(0, SHORTENED)}…{signature.slice(-SHORTENED)}
      </Mono>
    </a>
  );
}
