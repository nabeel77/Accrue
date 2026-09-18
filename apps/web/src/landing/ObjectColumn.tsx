import type { JSX } from 'react';

import { LANDING_COPY } from '../copy/landing.js';
import { LandingGuardCard } from './LandingGuardCard.js';
import { LandingWalletCard } from './LandingWalletCard.js';

const DIAL_CIRCUMFERENCE = '0 439.8';
const DIAL_TRACK = '293.2 439.8';
const DROPS = ['0', '1', '2', '3'] as const;

function Reserve(): JSX.Element {
  return (
    <div
      data-reserve
      style={{
        position: 'relative',
        flex: 'none',
        width: 'min(100%, 38cqh)',
        height: '26cqh',
        borderRadius: 16,
        border: '1px solid var(--color-hairline)',
        background: 'linear-gradient(180deg, transparent 0%, var(--color-panel) 72%)',
        overflow: 'hidden',
        opacity: 0,
      }}
    >
      <div
        data-fill
        style={{
          position: 'absolute',
          inset: 'auto 0 0 0',
          height: '0%',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 40%, transparent), color-mix(in srgb, var(--color-accent) 12%, transparent))',
          borderTop: '2px solid var(--color-accent-hover)',
        }}
      />
      <div
        data-dock
        style={{ position: 'absolute', left: '50%', bottom: '32%', width: 1, height: 1 }}
      />
      <div
        className="mono"
        style={{
          position: 'absolute',
          inset: '0 0 auto 0',
          padding: '12px 14px',
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--color-text-secondary)',
        }}
      >
        {LANDING_COPY.reserve.label}
      </div>
    </div>
  );
}

function Stream(): JSX.Element {
  return (
    <div
      data-stream
      style={{ position: 'relative', flex: 'none', width: 2, height: '7cqh', opacity: 0 }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 35%, transparent), transparent)',
        }}
      />
      {DROPS.map((drop) => (
        <span
          key={drop}
          data-drop={drop}
          className="mono"
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            transform: 'translate(-50%,0)',
            fontSize: 11,
            color: 'var(--color-accent)',
          }}
        >
          $
        </span>
      ))}
    </div>
  );
}

function Dial(): JSX.Element {
  return (
    <div data-dial style={{ position: 'absolute', width: 'min(80%, 22cqh)', opacity: 0 }}>
      <svg
        viewBox="0 0 180 180"
        aria-hidden="true"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <circle
          cx="90"
          cy="90"
          r="70"
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth="11"
          strokeDasharray={DIAL_TRACK}
          transform="rotate(150 90 90)"
        />
        <circle
          data-arc
          cx="90"
          cy="90"
          r="70"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="11"
          strokeDasharray={DIAL_CIRCUMFERENCE}
          transform="rotate(150 90 90)"
        />
        <g transform="rotate(30 90 90)">
          <line
            x1="90"
            y1="9"
            x2="90"
            y2="26"
            stroke="var(--color-health-danger)"
            strokeWidth="3"
          />
        </g>
        <text
          data-ltv
          x="90"
          y="86"
          textAnchor="middle"
          fill="var(--color-text)"
          fontFamily="var(--font-mono)"
          fontSize="28"
          letterSpacing="-1"
        >
          0.0%
        </text>
        <text
          x="90"
          y="105"
          textAnchor="middle"
          fill="var(--color-text-muted)"
          fontFamily="var(--font-mono)"
          fontSize="10"
        >
          {LANDING_COPY.dial.caption}
        </text>
      </svg>
    </div>
  );
}

function Destinations(): JSX.Element {
  return (
    <div
      data-dests
      style={{
        position: 'absolute',
        width: 'min(100%, 40cqh)',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
        gap: 'clamp(7px,1cqw,11px)',
        opacity: 0,
      }}
    >
      {LANDING_COPY.destinations.map((destination, index) => (
        <div
          key={destination.name}
          data-dest={index}
          style={{
            borderRadius: 12,
            background: 'var(--color-panel)',
            boxShadow: '0 0 0 1px var(--color-hairline)',
            padding: 'clamp(10px,1.3cqw,15px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 'clamp(12px,1.2cqw,14px)' }}>{destination.name}</span>
          <span
            className="mono"
            style={{ fontSize: 'clamp(15px,1.8cqw,21px)', color: 'var(--color-gold)' }}
          >
            {destination.target}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {LANDING_COPY.destinationTargetLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ObjectColumn(): JSX.Element {
  return (
    <div
      data-objcol
      style={{
        position: 'relative',
        flex: '1 1 300px',
        minWidth: 0,
        height: '62cqh',
        alignSelf: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.4cqh',
      }}
    >
      <Reserve />
      <Stream />
      <div
        data-slot2
        style={{
          position: 'relative',
          flex: 'none',
          width: '100%',
          height: '24cqh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Dial />
        <Destinations />
      </div>
      <LandingGuardCard />
      <LandingWalletCard />
    </div>
  );
}
