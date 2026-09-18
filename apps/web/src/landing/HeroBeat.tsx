import type { JSX } from 'react';

import { LANDING_COPY } from '../copy/landing.js';

const RISING_ARROW = 'M3 0.5 5.6 5.5 0.4 5.5Z';

function TickerRow({ doubled }: { doubled: string }): JSX.Element {
  return (
    <>
      {LANDING_COPY.ticker.map((entry) => (
        <span
          key={`${doubled}-${entry.symbol}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}
        >
          <span>{entry.symbol}</span>
          <span>{entry.price}</span>
          <svg
            width="6"
            height="6"
            viewBox="0 0 6 6"
            aria-hidden="true"
            style={{ transform: entry.rising ? 'none' : 'rotate(180deg)' }}
          >
            <path
              d={RISING_ARROW}
              fill={entry.rising ? 'var(--color-accent)' : 'var(--color-health-danger)'}
            />
          </svg>
          <span
            style={{
              color: entry.rising ? 'var(--color-accent)' : 'var(--color-health-danger)',
            }}
          >
            {entry.change}
          </span>
        </span>
      ))}
    </>
  );
}

export function HeroBeat(): JSX.Element {
  return (
    <div
      data-hero
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4cqh',
        padding: '12cqh 0 5cqh',
        overflow: 'hidden',
      }}
    >
      <canvas
        data-hero-canvas
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
      <div
        data-slot
        style={{
          position: 'absolute',
          left: 'calc(66.6% - 42px)',
          top: 'calc(46% - 26px)',
          width: 84,
          height: 52,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.8cqh',
          textAlign: 'center',
          padding: '0 clamp(14px,5cqw,56px)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 'clamp(34px,6.6cqw,80px)',
            fontWeight: 300,
            letterSpacing: '-.035em',
            lineHeight: 1.02,
          }}
        >
          <span data-hero-l="0">{LANDING_COPY.hero.headline}</span>
        </h1>
        <p
          data-hero-l="1"
          style={{
            margin: 0,
            fontSize: 'clamp(15px,1.7cqw,20px)',
            lineHeight: 1.5,
            color: 'var(--color-text-secondary)',
            maxWidth: '44ch',
            textWrap: 'balance',
          }}
        >
          {LANDING_COPY.hero.subheadline}
        </p>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '9cqh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2.2cqh',
        }}
      >
        <div
          data-ticker
          style={{
            width: '100%',
            overflow: 'hidden',
            maskImage:
              'linear-gradient(90deg, transparent, var(--color-ground) 8%, var(--color-ground) 92%, transparent)',
          }}
        >
          <div
            data-ticker-track
            className="mono"
            style={{
              display: 'flex',
              gap: 28,
              width: 'max-content',
              fontSize: 12,
              color: 'var(--color-text-muted)',
              padding: '0 14px',
              willChange: 'transform',
            }}
          >
            <TickerRow doubled="first" />
            <TickerRow doubled="second" />
          </div>
        </div>
        <div
          data-hint
          className="mono landing-scroll-hint"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
          }}
        >
          <span>{LANDING_COPY.scrollHint}</span>
          <span
            style={{
              width: 1,
              height: 18,
              background: 'linear-gradient(180deg, var(--color-text-muted), transparent)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
