'use client';

import { useEffect, useRef, type CSSProperties, type JSX } from 'react';

import { AccrueMark } from '../components/AccrueMark.js';
import { LANDING_COPY } from '../copy/landing.js';
import { FlowCard } from './FlowCard.js';
import { GuardCard } from './GuardCard.js';
import { HeroCanvas } from './heroCanvas.js';
import { revealOnScroll } from './reveal.js';
import { rollNumbersIntoView } from './rollNumbers.js';

const PAGE = 1180;
const SIDE = 'clamp(16px,4vw,56px)';
const BOTTOM = 'clamp(56px,8vh,120px)';

const EYEBROW: CSSProperties = {
  fontFamily: "'Geist Mono', monospace",
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: '#6E675F',
};

const TITLE: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(28px,3.4vw,44px)',
  fontWeight: 300,
  letterSpacing: '-.03em',
};

const SECTION: CSSProperties = {
  padding: `0 ${SIDE} ${BOTTOM}`,
  maxWidth: PAGE,
  margin: '0 auto',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 28,
};

function Wordmark({ size = 22, colour = '#F0EDE8' }): JSX.Element {
  return (
    <a
      href="#top"
      style={{ display: 'flex', alignItems: 'center', gap: 10, color: colour }}
    >
      <AccrueMark size={size} />
      <span
        style={{
          fontSize: size >= 22 ? 16 : 14,
          fontWeight: 500,
          letterSpacing: '-.02em',
        }}
      >
        {LANDING_COPY.wordmark}
      </span>
    </a>
  );
}

function OpenApp({ big = false }): JSX.Element {
  return (
    <a
      href="/app"
      data-testid="open-app"
      style={{
        background: '#37B98D',
        color: '#0C0B0A',
        borderRadius: 8,
        padding: big ? '0 24px' : '0 18px',
        height: big ? 50 : 40,
        display: 'flex',
        alignItems: 'center',
        fontSize: big ? 15 : 14,
        fontWeight: 500,
      }}
    >
      {LANDING_COPY.openApp}
    </a>
  );
}

function XMark(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L5.9 22H2.8l7.5-8.6L2.4 2h6.6l4.5 6.6L18.9 2Zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20Z" />
    </svg>
  );
}

export function LandingStage(): JSX.Element {
  const hero = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = hero.current;
    const surface = canvas.current;
    if (element === null || surface === null) {
      return;
    }
    const painting = new HeroCanvas(element, surface);
    return () => {
      painting.stop();
    };
  }, []);

  useEffect(() => {
    const element = root.current;
    if (element === null) {
      return;
    }
    const stopRevealing = revealOnScroll(element);
    const stopRolling = rollNumbersIntoView(element);
    return () => {
      stopRevealing();
      stopRolling();
    };
  }, []);

  return (
    <div
      ref={root}
      data-testid="landing"
      style={{
        background: '#0C0B0A',
        color: '#F0EDE8',
        fontFamily: "'Geist', system-ui, sans-serif",
      }}
    >
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: `16px ${SIDE}`,
          background: 'rgba(12,11,10,0.88)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <Wordmark />
        <OpenApp />
      </header>

      <section
        id="top"
        ref={hero}
        data-hero
        style={{
          position: 'relative',
          minHeight: '82vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          overflow: 'hidden',
          padding: `clamp(48px,10vh,120px) ${SIDE}`,
        }}
      >
        <canvas
          ref={canvas}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            opacity: 0.7,
          }}
        />
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            maxWidth: 820,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 28,
          }}
        >
          <h1
            data-testid="hero-headline"
            style={{
              margin: 0,
              fontSize: 'clamp(40px,6.2vw,84px)',
              fontWeight: 300,
              letterSpacing: '-.035em',
              lineHeight: 1.02,
            }}
          >
            {LANDING_COPY.hero.headline.split(' ').map((word, index) => (
              <span
                key={`${word}-${index}`}
                className="acr-word"
                style={{
                  display: 'inline-block',
                  whiteSpace: 'pre',
                  animationDelay: `${(index * 70) / 1_000}s`,
                }}
              >
                {index === LANDING_COPY.hero.headline.split(' ').length - 1
                  ? word
                  : `${word} `}
              </span>
            ))}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 'clamp(16px,1.4vw,20px)',
              lineHeight: 1.6,
              color: '#B8B1A8',
              maxWidth: '60ch',
            }}
          >
            {LANDING_COPY.hero.body}
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            <OpenApp big />
            <a
              href="#how"
              style={{
                border: '1px solid #22201D',
                color: '#D9D2C8',
                borderRadius: 8,
                padding: '0 22px',
                height: 50,
                display: 'flex',
                alignItems: 'center',
                fontSize: 15,
              }}
            >
              {LANDING_COPY.hero.seeHowItWorks}
            </a>
          </div>
        </div>
      </section>

      <section
        id="how"
        style={{
          padding: `clamp(56px,8vh,120px) ${SIDE} ${BOTTOM}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 36,
          maxWidth: PAGE,
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={EYEBROW}>{LANDING_COPY.howItWorks.eyebrow}</span>
          <h2 style={TITLE}>{LANDING_COPY.howItWorks.title}</h2>
        </div>
        <FlowCard />
        <a
          href="/app"
          style={{
            alignSelf: 'flex-start',
            background: '#37B98D',
            color: '#0C0B0A',
            borderRadius: 8,
            padding: '0 24px',
            height: 50,
            display: 'flex',
            alignItems: 'center',
            fontSize: 15,
            fontWeight: 500,
          }}
        >
          {LANDING_COPY.openApp}
        </a>
      </section>

      <section style={SECTION}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={EYEBROW}>{LANDING_COPY.tryTheGuard.eyebrow}</span>
          <h2 style={TITLE}>{LANDING_COPY.tryTheGuard.title}</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#6E675F' }}>
            {LANDING_COPY.tryTheGuard.setup}
          </p>
        </div>
        <GuardCard />
      </section>

      <section style={SECTION}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={EYEBROW}>{LANDING_COPY.whatItEarns.eyebrow}</span>
          <h2 style={TITLE}>{LANDING_COPY.whatItEarns.title}</h2>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: '#9A938A',
              maxWidth: '58ch',
              textWrap: 'pretty',
            }}
          >
            {LANDING_COPY.whatItEarns.note}
          </p>
        </div>
        <div
          className="tnum acr-earns"
          style={{
            background: '#121110',
            border: '1px solid #22201D',
            borderRadius: 16,
            padding: `0 clamp(16px,2.6vw,36px)`,
            display: 'grid',
            gridTemplateColumns: '1fr auto auto auto',
            columnGap: 'clamp(12px,2vw,28px)',
            alignItems: 'baseline',
          }}
        >
          {[
            LANDING_COPY.whatItEarns.stockColumn,
            LANDING_COPY.whatItEarns.earnsColumn,
            LANDING_COPY.whatItEarns.yieldColumn,
            LANDING_COPY.whatItEarns.loanColumn,
          ].map((heading, index) => (
            <span
              key={heading}
              style={{
                padding: '14px 0',
                fontSize: 11,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: '#6E675F',
                borderBottom: '1px solid #1A1815',
                textAlign: index === 0 ? 'left' : 'right',
              }}
            >
              {heading}
            </span>
          ))}
          {LANDING_COPY.whatItEarns.rows.map((row, rowIndex) => {
            const edge =
              rowIndex === LANDING_COPY.whatItEarns.rows.length - 1
                ? undefined
                : '1px solid #1A1815';
            const cell: CSSProperties = {
              padding: '18px 0',
              fontFamily: "'Geist Mono', monospace",
              fontSize: 15,
              borderBottom: edge,
            };
            return [
              <span key={`${row.symbol}-name`} style={cell}>
                {row.symbol}
              </span>,
              <span
                key={`${row.symbol}-earns`}
                data-testid={`earns-${row.symbol}`}
                style={{ ...cell, textAlign: 'right', color: '#E2B871' }}
              >
                {row.earns}
              </span>,
              <span
                key={`${row.symbol}-yield`}
                style={{ ...cell, textAlign: 'right', color: '#9A938A' }}
              >
                {row.yieldRate}
              </span>,
              <span
                key={`${row.symbol}-loan`}
                style={{ ...cell, textAlign: 'right', color: '#9A938A' }}
              >
                {row.loanRate}
              </span>,
            ];
          })}
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '14px 0',
              fontFamily: "'Geist Mono', monospace",
              fontSize: 12,
              color: '#6E675F',
              borderTop: '1px solid #1A1815',
            }}
          >
            {LANDING_COPY.whatItEarns.formula}
          </div>
        </div>
      </section>

      <section style={SECTION}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={EYEBROW}>{LANDING_COPY.whatYouKeep.eyebrow}</span>
        </div>
        <div className="acr-three" style={{ display: 'grid', gap: 14 }}>
          {LANDING_COPY.whatYouKeep.cards.map((card) => (
            <div
              key={card.title}
              style={{
                background: '#121110',
                border: '1px solid #22201D',
                borderRadius: 16,
                padding: 'clamp(20px,2.4vw,32px)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <AccrueMark size={20} monochrome monochromeColor="#37B98D" />
              <h3
                style={{
                  margin: 0,
                  fontSize: 19,
                  fontWeight: 500,
                  letterSpacing: '-.02em',
                }}
              >
                {card.title}
              </h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9A938A' }}>
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...SECTION, gap: 24 }}>
        <span style={EYEBROW}>{LANDING_COPY.builtOn.eyebrow}</span>
        <div className="acr-built" style={{ display: 'grid', gap: '12px 28px' }}>
          {LANDING_COPY.builtOn.parts.map((part) => (
            <div
              key={part.name}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '14px 0',
                borderTop: '1px solid #1A1815',
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-.02em' }}>
                {part.name}
              </span>
              <span style={{ fontSize: 13, color: '#6E675F' }}>{part.what}</span>
            </div>
          ))}
        </div>
      </section>

      <footer
        style={{
          borderTop: '1px solid #161412',
          padding: `32px ${SIDE} 48px`,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '16px 28px',
          maxWidth: PAGE,
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <Wordmark size={18} colour="#9A938A" />
        <a href="/app" style={{ fontSize: 14, color: '#9A938A' }}>
          {LANDING_COPY.openApp}
        </a>
        <a href="/app/about" style={{ fontSize: 14, color: '#9A938A' }}>
          {LANDING_COPY.about}
        </a>
        <a
          href={LANDING_COPY.xHref}
          target="_blank"
          rel="noreferrer"
          aria-label={LANDING_COPY.xLabel}
          data-testid="x-link"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 14,
            color: '#9A938A',
          }}
        >
          <XMark />
        </a>
      </footer>
    </div>
  );
}
