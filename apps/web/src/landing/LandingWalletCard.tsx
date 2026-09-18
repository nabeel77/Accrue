import type { JSX } from 'react';

import { LANDING_COPY } from '../copy/landing.js';

export function LandingWalletCard(): JSX.Element {
  const wallet = LANDING_COPY.wallet;
  const labelStyle = { color: 'var(--color-text-secondary)' };
  const valueStyle = { textAlign: 'right' as const };
  return (
    <div
      data-wallet
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0,
      }}
    >
      <div
        style={{
          width: 'min(100%, 40cqh)',
          borderRadius: 16,
          border: '1px solid var(--color-hairline)',
          background: 'var(--color-panel)',
          padding: 'clamp(14px,1.8cqw,20px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          className="mono"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 10,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span>{wallet.title}</span>
          <span className="mono" style={{ letterSpacing: 0, textTransform: 'none' }}>
            {wallet.address}
          </span>
        </div>
        <div data-wallet-dock style={{ height: 'clamp(40px,6cqh,56px)' }} />
        <div
          className="mono"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '8px 16px',
            fontSize: 'clamp(12px,1.3cqw,14px)',
          }}
        >
          <span style={labelStyle}>{wallet.stockRow}</span>
          <span data-w="stock" style={valueStyle}>
            0.0000
          </span>
          <span style={labelStyle}>{wallet.borrowRow}</span>
          <span data-w="borrow" style={valueStyle}>
            0.00
          </span>
          <span style={labelStyle}>{wallet.destinationRow}</span>
          <span
            data-w="destination"
            style={{ ...valueStyle, color: 'var(--color-gold)' }}
          >
            0.00
          </span>
        </div>
        <span
          data-wallet-note
          style={{ fontSize: 11, color: 'var(--color-text-muted)', opacity: 0 }}
        >
          {wallet.note}
        </span>
      </div>
    </div>
  );
}
