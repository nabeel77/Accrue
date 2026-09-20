'use client';

import { useEffect, useRef, useState, type JSX } from 'react';

import { LANDING_COPY } from '../copy/landing.js';
import {
  colourForLoanToValue,
  GUARD,
  liquidationPriceFor,
  loanAfterTheGuardActs,
  loanToValueAt,
  theGuardPrice,
} from './flowFrames.js';

const COPY = LANDING_COPY.tryTheGuard;
const NUDGE_TO = 148;
const NUDGE_MILLISECONDS = 2_600;
const NUDGE_WAIT = 500;

function money(value: number, places = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

function easeInOut(fraction: number): number {
  return fraction < 0.5
    ? 2 * fraction * fraction
    : 1 - Math.pow(-2 * fraction + 2, 2) / 2;
}

function acrossTheTrack(price: number): string {
  return `${(((price - GUARD.lowest) / (GUARD.highest - GUARD.lowest)) * 100).toFixed(1)}%`;
}

export function GuardCard(): JSX.Element {
  const [price, setPrice] = useState<number>(GUARD.start);
  const [fired, setFired] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  const guardPrice = theGuardPrice();
  const loan = fired ? loanAfterTheGuardActs() : GUARD.loan;
  const loanToValue = loanToValueAt(loan, price);
  const liquidation = liquidationPriceFor(loan);
  const colour = colourForLoanToValue(loanToValue);

  useEffect(() => {
    if (!fired && price <= guardPrice) {
      setFired(true);
    }
    if (fired && price > guardPrice + GUARD.releaseAbove) {
      setFired(false);
    }
  }, [price, fired, guardPrice]);

  useEffect(() => {
    const element = card.current;
    if (
      element === null ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    let raf = 0;
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          watcher.disconnect();
          const startedAt = performance.now() + NUDGE_WAIT;
          const walk = (now: number): void => {
            if (touched.current) {
              return;
            }
            const along = easeInOut(
              Math.min(1, Math.max(0, (now - startedAt) / NUDGE_MILLISECONDS)),
            );
            setPrice(Math.round(GUARD.start + (NUDGE_TO - GUARD.start) * along));
            if (along < 1) {
              raf = requestAnimationFrame(walk);
            }
          };
          raf = requestAnimationFrame(walk);
        }
      },
      { threshold: 0.5 },
    );
    watcher.observe(element);
    return () => {
      watcher.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={card}
      data-guard
      className="acr-guard"
      style={{
        background: '#121110',
        border: '1px solid #22201D',
        borderRadius: 16,
        padding: 'clamp(20px,2.6vw,36px)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 'clamp(24px,3vw,48px)',
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 14, color: '#9A938A' }}>{COPY.priceLabel}</span>
          <span
            className="tnum"
            data-testid="guard-price"
            style={{
              fontFamily: "'Geist Mono', monospace",
              fontSize: 32,
              letterSpacing: '-.02em',
            }}
          >
            {`$${money(price)}`}
          </span>
        </div>

        <div style={{ position: 'relative' }}>
          <input
            type="range"
            className="acr"
            data-testid="guard-range"
            aria-label={COPY.priceLabel}
            min={GUARD.lowest}
            max={GUARD.highest}
            step={1}
            value={price}
            onPointerDown={() => {
              touched.current = true;
            }}
            onChange={(event) => {
              touched.current = true;
              setPrice(Number(event.target.value));
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 14,
              left: acrossTheTrack(guardPrice),
              width: 1,
              height: 16,
              background: '#37B98D',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 14,
              left: acrossTheTrack(liquidation),
              width: 1,
              height: 16,
              background: '#E2B871',
              pointerEvents: 'none',
            }}
          />
          <div
            className="tnum"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: "'Geist Mono', monospace",
              fontSize: 11,
              color: '#6E675F',
              marginTop: 2,
            }}
          >
            <span>{COPY.lowest}</span>
            <span style={{ color: '#E2B871' }}>
              {COPY.liquidationAt(`$${money(liquidation)}`)}
            </span>
            <span>{COPY.highest}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 13,
              color: '#9A938A',
            }}
          >
            <span>{COPY.loanToValue}</span>
            <span
              className="tnum"
              data-testid="guard-ltv"
              style={{ fontFamily: "'Geist Mono', monospace", color: colour }}
            >
              {`${money(loanToValue * 100, 1)}%`}
            </span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 4,
              background: '#191715',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, (loanToValue / GUARD.liquidation) * 100).toFixed(1)}%`,
                background: colour,
                transition: 'width .2s, background-color .2s',
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div style={{ minHeight: 56, display: 'flex', alignItems: 'center' }}>
          {fired ? (
            <div
              className="tnum"
              data-testid="guard-chip"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                border: '1px solid #37B98D',
                borderRadius: 999,
                padding: '10px 16px',
                fontFamily: "'Geist Mono', monospace",
                fontSize: 13,
                color: '#F0EDE8',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#37B98D',
                  flex: 'none',
                }}
              />
              <span>
                {COPY.repaid(
                  `$${money(GUARD.loan - loanAfterTheGuardActs(), 0)}`,
                  `$${money(liquidationPriceFor(GUARD.loan))}`,
                  `$${money(liquidationPriceFor(loanAfterTheGuardActs()))}`,
                )}
              </span>
            </div>
          ) : (
            <span data-testid="guard-idle" style={{ fontSize: 14, color: '#6E675F' }}>
              {COPY.idleBefore}
              <span className="tnum" style={{ fontFamily: "'Geist Mono', monospace" }}>
                {`$${money(guardPrice)}`}
              </span>
              {COPY.idleAfter}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
