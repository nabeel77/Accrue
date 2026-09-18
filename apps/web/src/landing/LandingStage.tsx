'use client';

import Link from 'next/link';
import { useEffect, useRef, type JSX } from 'react';

import { AccrueMark } from '../components/AccrueMark.js';
import { LANDING_COPY } from '../copy/landing.js';
import { mountAccrueMotion } from './accrueMotion.js';
import { mountHeroCanvas } from './heroCanvas.js';
import { readLandingPalette } from './palette.js';
import { BeatCopy } from './BeatCopy.js';
import { HeroBeat } from './HeroBeat.js';
import { ObjectColumn } from './ObjectColumn.js';

const SCROLL_SPAN = '900vh';
const RAIL_DOTS = ['01', '02', '03', '04', '05', '06'] as const;
const NOISE_TEXTURE =
  "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%222%22/><feColorMatrix type=%22saturate%22 values=%220%22/></filter><rect width=%22160%22 height=%22160%22 filter=%22url(%23n)%22 opacity=%220.35%22/></svg>')";

const openAppLinkStyle = {
  border: '1px solid var(--color-accent)',
  color: 'var(--color-accent)',
  borderRadius: 'var(--radius)',
  display: 'flex',
  alignItems: 'center',
};

export function LandingStage(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    const hero = root.querySelector<HTMLElement>('[data-hero]');
    const canvas = root.querySelector<HTMLCanvasElement>('[data-hero-canvas]');
    const motion = mountAccrueMotion(root, {
      liquidationLabelPrefix: LANDING_COPY.guard.liquidatedAtPrefix,
    });
    const livingHero =
      hero === null || canvas === null
        ? null
        : mountHeroCanvas(hero, canvas, readLandingPalette(root), LANDING_COPY.heroChart);
    return () => {
      motion.stop();
      livingHero?.stop();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        background: 'var(--color-ground)',
        color: 'var(--color-text)',
      }}
    >
      <div data-scroll style={{ height: SCROLL_SPAN, position: 'relative' }}>
        <div
          data-stage
          style={{
            position: 'sticky',
            top: 0,
            height: '100vh',
            width: '100%',
            overflow: 'hidden',
            containerType: 'size',
            background: 'var(--color-ground)',
          }}
        >
          <div
            data-glow-a
            style={{
              position: 'absolute',
              left: '50%',
              top: '20%',
              width: '120cqh',
              height: '120cqh',
              margin: '-60cqh 0 0 -60cqh',
              borderRadius: '50%',
              background:
                'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 64%)',
              opacity: 0.4,
            }}
          />
          <div
            data-glow-b
            style={{
              position: 'absolute',
              left: '72%',
              top: '62%',
              width: '90cqh',
              height: '90cqh',
              margin: '-45cqh 0 0 -45cqh',
              borderRadius: '50%',
              background:
                'radial-gradient(circle, color-mix(in srgb, var(--color-gold) 14%, transparent), transparent 62%)',
              opacity: 0,
            }}
          />
          <div
            data-vign
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse at 50% 50%, transparent 38%, color-mix(in srgb, var(--color-ground) 85%, transparent) 100%)',
              opacity: 0.25,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              opacity: 0.4,
              mixBlendMode: 'soft-light',
              backgroundImage: NOISE_TEXTURE,
            }}
          />

          <header
            style={{
              position: 'absolute',
              zIndex: 9,
              top: 0,
              left: 0,
              right: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '2.4cqh clamp(14px,4cqw,44px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AccrueMark size={22} />
              <span
                style={{
                  fontSize: 'clamp(14px,1.3cqw,17px)',
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                }}
              >
                {LANDING_COPY.wordmark}
              </span>
            </div>
            <Link
              data-cursor
              data-testid="open-app-header"
              href="/app"
              style={{ ...openAppLinkStyle, padding: '0 18px', height: 44, fontSize: 14 }}
            >
              {LANDING_COPY.openApp}
            </Link>
          </header>

          <div
            data-rail
            style={{
              position: 'absolute',
              zIndex: 8,
              right: 'clamp(10px,1.6cqw,22px)',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              className="mono"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 9,
                letterSpacing: '.1em',
                color: 'var(--color-text-muted)',
              }}
            >
              {RAIL_DOTS.map((dot, index) => (
                <span key={dot} data-rail-dot={index}>
                  {dot}
                </span>
              ))}
            </div>
            <div
              style={{
                position: 'relative',
                width: 2,
                height: '28cqh',
                background: 'var(--color-hairline)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                data-rail-fill
                style={{
                  position: 'absolute',
                  inset: '0 0 auto 0',
                  height: '0%',
                  background:
                    'linear-gradient(180deg, var(--color-accent), var(--color-accent-deep))',
                }}
              />
            </div>
          </div>

          <HeroBeat />

          <div
            data-set
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'clamp(18px,3cqw,56px)',
              padding: '13cqh clamp(14px,5cqw,56px) 8cqh',
              pointerEvents: 'none',
            }}
          >
            <BeatCopy />
            <ObjectColumn />
          </div>

          <div
            data-close
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2.6cqh',
              padding: '14cqh clamp(14px,5cqw,56px) 10cqh',
              opacity: 0,
              pointerEvents: 'none',
            }}
          >
            <span data-close-mark style={{ display: 'inline-flex' }}>
              <AccrueMark size={76} />
            </span>
            <Link
              data-cline="0"
              data-cursor
              data-testid="open-app-close"
              href="/app"
              style={{
                ...openAppLinkStyle,
                padding: '0 24px',
                height: 50,
                fontSize: 16,
                pointerEvents: 'auto',
              }}
            >
              {LANDING_COPY.openApp}
            </Link>
          </div>

          <div
            data-follow
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              zIndex: 6,
              borderRadius: 12,
              background: 'var(--color-panel)',
              boxShadow: '0 0 0 1px var(--color-hairline)',
              padding: 'clamp(11px,1.5cqw,18px) clamp(9px,1.2cqw,16px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 5,
              opacity: 0,
              transformOrigin: '50% 50%',
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 'clamp(11px,1.2cqw,15px)', fontWeight: 500 }}
            >
              {LANDING_COPY.followToken.symbol}
            </span>
            <span
              data-follow-value
              className="mono"
              style={{
                fontSize: 'clamp(9px,.85cqw,12px)',
                color: 'var(--color-gold)',
                opacity: 0,
              }}
            >
              {LANDING_COPY.followToken.value}
            </span>
            <span
              data-yours
              className="mono"
              style={{
                position: 'absolute',
                right: -9,
                bottom: -11,
                background: 'var(--color-ground)',
                border: '1px solid var(--color-accent)',
                color: 'var(--color-accent)',
                borderRadius: 'var(--radius-pill)',
                padding: '2px 9px',
                fontSize: 10,
                letterSpacing: '.06em',
                opacity: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {LANDING_COPY.followToken.badge}
            </span>
          </div>

          <div
            data-cursor-dot
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              zIndex: 10,
              width: 12,
              height: 12,
              margin: '-6px 0 0 -6px',
              borderRadius: '50%',
              border:
                '1px solid color-mix(in srgb, var(--color-accent) 70%, transparent)',
              opacity: 0,
              pointerEvents: 'none',
              transition:
                'width .18s ease, height .18s ease, margin .18s ease, background-color .18s ease',
            }}
          />
        </div>
      </div>

      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '32px clamp(14px,4vw,44px) 40px',
          borderTop: '1px solid var(--color-hairline)',
        }}
      >
        <AccrueMark size={18} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--color-text-secondary)',
          }}
        >
          {LANDING_COPY.wordmark}
        </span>
      </footer>
    </div>
  );
}
