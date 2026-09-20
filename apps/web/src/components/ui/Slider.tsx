'use client';

import type { JSX } from 'react';

import { Mono, Row } from './primitives.js';

const PERCENT = 100;

// The slider for the whole app, with a number beside it for anyone who wants an exact percent.
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  readout,
  isDefault,
  onReset,
  note,
  testId,
  numberTestId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  readout: string;
  isDefault: boolean;
  onReset: () => void;
  note: string;
  testId?: string;
  numberTestId?: string;
}): JSX.Element {
  return (
    <div>
      <Row>
        <span style={{ color: 'var(--color-text)' }}>{label}</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {isDefault ? null : (
            <button
              type="button"
              onClick={onReset}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Reset to default
            </button>
          )}
          <Mono tone="secondary">{readout}</Mono>
        </span>
      </Row>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <input
          type="range"
          data-testid={testId}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
          style={{ flex: 1, accentColor: 'var(--color-accent)' }}
        />
        <input
          type="number"
          inputMode="numeric"
          data-testid={numberTestId}
          min={min / PERCENT}
          max={max / PERCENT}
          value={value / PERCENT}
          onChange={(event) => {
            const typed = Number(event.target.value);
            if (Number.isFinite(typed)) {
              onChange(Math.round(typed * PERCENT));
            }
          }}
          style={{
            width: 78,
            minHeight: 44,
            background: 'var(--color-ground)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 10,
            padding: '8px 10px',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
      </span>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '4px 0 0' }}>
        {note}
      </p>
    </div>
  );
}
