import type { JSX } from 'react';

import { LANDING_COPY } from '../copy/landing.js';

const FIRST_BEAT_NUMBER = 2;

const copyBlockStyle = {
  position: 'absolute' as const,
  inset: 'auto 0 auto 0',
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '2.4cqh',
};

const indexStyle = {
  fontSize: 'clamp(10px,1cqw,11px)',
  letterSpacing: '.18em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-accent)',
};

const headingStyle = {
  margin: 0,
  fontSize: 'clamp(26px,4.4cqw,54px)',
  fontWeight: 300,
  letterSpacing: '-.03em',
  lineHeight: 1.06,
};

const bodyStyle = {
  margin: 0,
  fontSize: 'clamp(15px,1.6cqw,19px)',
  lineHeight: 1.55,
  color: 'var(--color-text-secondary)',
  maxWidth: '36ch',
};

function BorrowFigures(): JSX.Element {
  const figures = LANDING_COPY.borrowFigures;
  const columnStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 };
  const labelStyle = {
    fontSize: 10,
    letterSpacing: '.14em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-muted)',
  };
  const valueStyle = { fontSize: 'clamp(18px,2cqw,24px)' };
  return (
    <div
      data-line="3"
      className="mono"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(16px,2.4cqw,32px)' }}
    >
      <span style={columnStyle}>
        <span style={labelStyle}>{figures.borrowedLabel}</span>
        <span data-num="borrow" style={valueStyle}>
          $0.00
        </span>
      </span>
      <span style={columnStyle}>
        <span style={labelStyle}>{figures.borrowCostLabel}</span>
        <span style={valueStyle}>{figures.borrowCostValue}</span>
      </span>
      <span style={columnStyle}>
        <span style={labelStyle}>{figures.aYearLabel}</span>
        <span data-num="interest" style={{ ...valueStyle, color: 'var(--color-gold)' }}>
          $0.00
        </span>
      </span>
    </div>
  );
}

export function BeatCopy(): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        flex: '1 1 300px',
        minWidth: 0,
        alignSelf: 'center',
        height: '62cqh',
      }}
    >
      {LANDING_COPY.beats.map((beat, position) => {
        const beatNumber = position + FIRST_BEAT_NUMBER;
        return (
          <div key={beat.index} data-copy={beatNumber} style={copyBlockStyle}>
            <span data-line="0" className="mono" style={indexStyle}>
              {beat.index}
            </span>
            <h2 data-line="1" style={headingStyle}>
              {beat.heading}
            </h2>
            <p data-line="2" style={bodyStyle}>
              {beat.body}
            </p>
            {beat.index === '03' ? <BorrowFigures /> : null}
          </div>
        );
      })}
    </div>
  );
}
