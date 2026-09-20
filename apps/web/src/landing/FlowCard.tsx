'use client';

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { LANDING_COPY } from '../copy/landing.js';
import { FLOW_STEPS, frameFor } from './flowFrames.js';
import { pinTheFlow, type PinnedFlow } from './pinFlow.js';

const COPY = LANDING_COPY.howItWorks;
const DIAGRAM = COPY.diagram;
const COUNTER_EVERY = 400;
const COUNTER_STEP = 0.01;
const SWIPE = 40;
const WHEEL_ENOUGH = 12;
const WHEEL_LOCK = 700;

const SLOW =
  'transform 1.1s cubic-bezier(.4,0,.2,1), opacity .6s ease, width 1.1s cubic-bezier(.4,0,.2,1), stroke-dasharray 1.1s cubic-bezier(.4,0,.2,1)';
const QUICK = 'transform .7s cubic-bezier(.4,0,.2,1), opacity .5s ease';

function money(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function FlowCard(): JSX.Element {
  const [step, setStep] = useState(0);
  const [counter, setCounter] = useState(0);
  const touchedAt = useRef<number | null>(null);
  const pin = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pinned = useRef<PinnedFlow | null>(null);
  const stepNow = useRef(0);
  const frame = frameFor(step);

  const go = useCallback((next: number): void => {
    if (next < 0 || next >= FLOW_STEPS || next === stepNow.current) {
      return;
    }
    stepNow.current = next;
    setStep(next);
    setCounter(0);
  }, []);

  const scrollTo = useCallback(
    (next: number): void => {
      if (pinned.current === null) {
        go(next);
        return;
      }
      pinned.current.jumpTo(next);
    },
    [go],
  );

  useEffect(() => {
    const wrapper = pin.current;
    const surface = card.current;
    if (wrapper === null || surface === null) {
      return;
    }
    const controller = pinTheFlow(wrapper, surface, go);
    pinned.current = controller;
    return () => {
      controller.stop();
      pinned.current = null;
    };
  }, [go]);

  useEffect(() => {
    const surface = card.current;
    if (surface === null) {
      return;
    }
    let lockedUntil = 0;
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) < WHEEL_ENOUGH) {
        return;
      }
      const direction = event.deltaY > 0 ? 1 : -1;
      const atTheEdge =
        (direction > 0 && stepNow.current === FLOW_STEPS - 1) ||
        (direction < 0 && stepNow.current === 0);
      if (atTheEdge) {
        return;
      }
      event.preventDefault();
      const now = performance.now();
      if (now - lockedUntil < WHEEL_LOCK) {
        return;
      }
      lockedUntil = now;
      go(stepNow.current + direction);
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      surface.removeEventListener('wheel', onWheel);
    };
  }, [go]);

  useEffect(() => {
    if (step !== 2) {
      return;
    }
    const ticking = setInterval(() => {
      setCounter((current) => current + COUNTER_STEP);
    }, COUNTER_EVERY);
    return () => {
      clearInterval(ticking);
    };
  }, [step]);

  const coins = [
    { x: frame.coinOneX, y: frame.coinY, scale: 1, opacity: frame.coinOpacity },
    { x: frame.coinTwoX, y: frame.coinY, scale: 1, opacity: frame.coinOpacity },
    {
      x: frame.coinThreeX,
      y: frame.coinThreeY,
      scale: frame.coinThreeScale,
      opacity: frame.coinThreeOpacity,
    },
  ];

  return (
    <div ref={pin} data-flow-pin style={{ position: 'relative' }}>
      <div
        ref={card}
        data-flow
        onTouchStart={(event) => {
          touchedAt.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const from = touchedAt.current;
          const to = event.changedTouches[0]?.clientX;
          if (from === null || to === undefined) {
            return;
          }
          if (to - from < -SWIPE) {
            go(step + 1);
          }
          if (to - from > SWIPE) {
            go(step - 1);
          }
          touchedAt.current = null;
        }}
        style={{
          background: '#121110',
          border: '1px solid #22201D',
          borderRadius: 16,
          padding: 'clamp(20px,2.6vw,36px)',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)',
          gap: 'clamp(24px,3vw,48px)',
          alignItems: 'center',
        }}
        className="acr-flow"
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '26/15',
            minWidth: 0,
          }}
        >
          <svg
            viewBox="0 0 520 300"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
              fontFamily: "'Geist Mono', monospace",
            }}
          >
            <g>
              <rect
                x="28"
                y="110"
                width="88"
                height="66"
                rx="12"
                fill="#0C0B0A"
                stroke="#22201D"
              />
              <rect x="28" y="128" width="88" height="10" fill="#191715" />
              <circle cx="98" cy="152" r="5" fill="#37B98D" />
              <text x="72" y="202" textAnchor="middle" fontSize="11" fill="#6E675F">
                {DIAGRAM.wallet}
              </text>
            </g>

            <g>
              <rect
                x="196"
                y="58"
                width="296"
                height="184"
                rx="16"
                fill="#0C0B0A"
                stroke={frame.boxStroke}
                strokeWidth="1.5"
                style={{ transition: 'stroke .7s ease' }}
              />
              <text
                x="344"
                y="46"
                textAnchor="middle"
                fontSize="11"
                fill="#9A938A"
                letterSpacing="1.5"
              >
                {DIAGRAM.yourPosition}
              </text>
            </g>

            <g style={{ opacity: frame.gaugeOpacity, transition: SLOW }}>
              <path
                d="M 400 200 A 40 40 0 1 1 480 200"
                fill="none"
                stroke="#191715"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M 400 200 A 40 40 0 1 1 480 200"
                fill="none"
                stroke="#37B98D"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={frame.gaugeDash}
                style={{ transition: SLOW }}
              />
              <text x="440" y="222" textAnchor="middle" fontSize="10" fill="#6E675F">
                {DIAGRAM.borrowed}
              </text>
            </g>

            <g style={{ opacity: frame.loanOpacity, transition: SLOW }}>
              <text x="222" y="226" fontSize="10" fill="#6E675F">
                {DIAGRAM.loan}
              </text>
              <rect x="222" y="232" width="150" height="8" rx="4" fill="#191715" />
              <rect
                x="222"
                y="232"
                width={frame.loanWidth}
                height="8"
                rx="4"
                fill="#9A938A"
                style={{ transition: SLOW }}
              />
            </g>

            <g style={{ opacity: frame.chartOpacity, transition: SLOW }}>
              <polyline
                points="222,152 240,150 254,156 268,148 282,154 296,150 310,162 322,176 332,180 344,174 356,170"
                fill="none"
                stroke="#37B98D"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <line
                x1="222"
                y1="180"
                x2="340"
                y2="180"
                stroke="#37B98D"
                strokeDasharray="2 4"
                opacity=".7"
              />
              <text x="344" y="183" fontSize="9" fill="#37B98D">
                {DIAGRAM.guard}
              </text>
              <line
                x1="222"
                y1={frame.liquidationY}
                x2="340"
                y2={frame.liquidationY}
                stroke="#E2B871"
                strokeDasharray="2 4"
                style={{ transition: SLOW }}
              />
              <text
                x="344"
                y={frame.liquidationY + 3}
                fontSize="9"
                fill="#E2B871"
                style={{ transition: SLOW }}
              >
                {DIAGRAM.liquidation}
              </text>
              <line
                x1="332"
                y1="174"
                x2="332"
                y2="186"
                stroke="#37B98D"
                strokeWidth="2"
                style={{ opacity: frame.tickOpacity }}
              />
            </g>

            <g style={{ opacity: frame.counterOpacity, transition: SLOW }}>
              <text x="344" y="204" textAnchor="middle" fontSize="10" fill="#6E675F">
                {DIAGRAM.yieldSoFar}
              </text>
            </g>

            <g
              style={{
                opacity: frame.profitOpacity,
                transform: `translate(${frame.profitX}px,${frame.profitY}px)`,
                transition: QUICK,
              }}
            >
              <rect
                x="-30"
                y="-11"
                width="60"
                height="22"
                rx="11"
                fill="#0C0B0A"
                stroke="#37B98D"
              />
              <text x="0" y="4" textAnchor="middle" fontSize="11" fill="#37B98D">
                {DIAGRAM.profit}
              </text>
            </g>
          </svg>

          <span
            className="tnum"
            style={{
              position: 'absolute',
              left: '84.6%',
              top: '63.5%',
              transform: 'translate(-50%,-50%)',
              opacity: frame.gaugeOpacity,
              fontFamily: "'Geist Mono', monospace",
              fontSize: 'clamp(9px,1.5vw,16px)',
              color: '#F0EDE8',
              pointerEvents: 'none',
              transition: QUICK,
            }}
          >
            {frame.gaugeText}
          </span>

          <span
            className="tnum"
            data-testid="flow-counter-value"
            style={{
              position: 'absolute',
              left: '66.2%',
              top: '60%',
              transform: 'translate(-50%,-50%)',
              opacity: frame.counterOpacity,
              fontFamily: "'Geist Mono', monospace",
              fontSize: 'clamp(12px,2.1vw,22px)',
              color: '#E2B871',
              pointerEvents: 'none',
              transition: QUICK,
            }}
          >
            {`$${money(counter)}`}
          </span>

          <div
            style={{
              position: 'absolute',
              left: `${frame.stockX}%`,
              top: `${frame.stockY}%`,
              width: '11.5%',
              aspectRatio: '1',
              transform: `translate(-50%,-50%) scale(${frame.stockScale})`,
              borderRadius: '50%',
              background: '#141210',
              border: '1.5px solid #37B98D',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              transition: QUICK,
            }}
          >
            <span
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 'clamp(7px,1.1vw,11px)',
                fontWeight: 500,
                color: '#F0EDE8',
              }}
            >
              {DIAGRAM.stock}
            </span>
          </div>

          {coins.map((coin, index) => (
            <div
              key={index}
              style={{
                position: 'absolute',
                left: `${coin.x}%`,
                top: `${coin.y}%`,
                width: '8.5%',
                aspectRatio: '1',
                transform: `translate(-50%,-50%) scale(${coin.scale})`,
                opacity: coin.opacity,
                borderRadius: '50%',
                background: '#141210',
                border: `1.5px solid ${frame.coinStroke}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                transition: QUICK,
              }}
            >
              <span
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 'clamp(6px,.95vw,10px)',
                  color: frame.coinStroke,
                }}
              >
                {frame.coinLabel}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          <span
            className="tnum"
            data-testid="flow-counter"
            style={{
              fontFamily: "'Geist Mono', monospace",
              fontSize: 11,
              letterSpacing: '.16em',
              color: '#37B98D',
            }}
          >
            {COPY.counter(
              String(step + 1).padStart(2, '0'),
              String(FLOW_STEPS).padStart(2, '0'),
            )}
          </span>
          <p
            data-testid="flow-sentence"
            style={{
              margin: 0,
              fontSize: 'clamp(18px,1.7vw,24px)',
              lineHeight: 1.45,
              fontWeight: 300,
              color: '#F0EDE8',
              minHeight: '4.4em',
            }}
          >
            {COPY.steps[step]}
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              {COPY.steps.map((unused, index) => (
                <button
                  key={index}
                  type="button"
                  data-testid={`flow-dot-${index}`}
                  aria-label={COPY.stepLabel(String(index + 1))}
                  onClick={() => {
                    scrollTo(index);
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      width: index === step ? 22 : 6,
                      height: 6,
                      borderRadius: 3,
                      background: index === step ? '#37B98D' : '#2A2724',
                      transition: 'width .3s, background-color .3s',
                    }}
                  />
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                data-testid="flow-prev"
                aria-label={COPY.previousLabel}
                disabled={step === 0}
                onClick={() => {
                  scrollTo(step - 1);
                }}
                style={{
                  height: 44,
                  width: 44,
                  borderRadius: 8,
                  border: '1px solid #22201D',
                  background: 'transparent',
                  color: '#9A938A',
                  cursor: step === 0 ? 'default' : 'pointer',
                  opacity: step === 0 ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path
                    d="M9 2 4 7l5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </button>
              <button
                type="button"
                data-testid="flow-next"
                onClick={() => {
                  scrollTo(step === FLOW_STEPS - 1 ? 0 : step + 1);
                }}
                style={{
                  height: 44,
                  padding: '0 18px',
                  borderRadius: 8,
                  border: '1px solid #37B98D',
                  background: 'transparent',
                  color: '#37B98D',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                {step === FLOW_STEPS - 1 ? COPY.startOver : COPY.next}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
