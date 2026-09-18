import type { JSX } from 'react';

import { LANDING_COPY } from '../copy/landing.js';

const STOCK_PATH =
  'M0,52 C30,50 50,44 80,46 S130,58 160,54 S205,84 230,96 S270,102 320,100';

export function LandingGuardCard(): JSX.Element {
  const guard = LANDING_COPY.guard;
  return (
    <div
      data-guard
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
          width: 'min(100%, 52cqh)',
          borderRadius: 16,
          border: '1px solid var(--color-hairline)',
          background: 'var(--color-panel)',
          padding: 'clamp(12px,1.6cqw,18px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          className="mono"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span>{guard.symbol}</span>
          <span data-guard-tag style={{ color: 'var(--color-accent)', opacity: 0 }}>
            {guard.tag}
          </span>
        </div>
        <svg
          viewBox="0 0 320 150"
          aria-hidden="true"
          style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        >
          <line
            data-liq
            x1="0"
            x2="320"
            y1="118"
            y2="118"
            stroke="var(--color-health-danger)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <text
            data-liq-label
            x="320"
            y="113"
            textAnchor="end"
            fill="var(--color-health-danger)"
            fontFamily="var(--font-mono)"
            fontSize="9"
          >
            {`${guard.liquidatedAtPrefix}$117.33`}
          </text>
          <path
            data-stock
            d={STOCK_PATH}
            fill="none"
            stroke="var(--color-text)"
            strokeWidth="2"
            strokeDasharray="0 1000"
          />
          <circle
            data-tick
            cx="230"
            cy="96"
            r="0"
            fill="var(--color-accent)"
            opacity="0"
          />
          <circle
            data-tick-ring
            cx="230"
            cy="96"
            r="6"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
            opacity="0"
          />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            className="mono"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--color-text-secondary)',
            }}
          >
            <span>{guard.loanLabel}</span>
            <span data-loan-text>$400.00</span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 5,
              background: 'var(--color-raised)',
              overflow: 'hidden',
            }}
          >
            <div
              data-loan-bar
              style={{
                height: '100%',
                width: '66%',
                background:
                  'linear-gradient(90deg, var(--color-accent), var(--color-accent-deep))',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
