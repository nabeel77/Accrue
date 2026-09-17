import type { JSX } from 'react';

import { Mono } from './primitives.js';

export function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletPill({ address }: { address: string }): JSX.Element {
  return (
    <span
      data-testid="wallet-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius-pill)',
        padding: '6px 12px',
        background: 'var(--color-raised)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: 'var(--color-accent)',
        }}
      />
      <Mono>{shortenAddress(address)}</Mono>
    </span>
  );
}
