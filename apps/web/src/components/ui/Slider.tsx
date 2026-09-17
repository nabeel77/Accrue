'use client';

import type { JSX } from 'react';

import { Mono, Row } from './primitives.js';

/** The slider for the whole app: 4 pixel track, 22 pixel thumb, jade focus ring. */
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
}): JSX.Element {
  return (
    <div>
      <Row>
        <span style={{ color: 'var(--color-text)' }}>{label}</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {isDefault ? (
            <span
              style={{
                fontSize: 12,
                color: 'var(--color-accent)',
                border: '1px solid var(--color-accent-deeper)',
                borderRadius: 'var(--radius-pill)',
                padding: '2px 8px',
              }}
            >
              Accrue default
            </span>
          ) : (
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
        style={{ width: '100%', accentColor: 'var(--color-accent)', marginTop: 10 }}
      />
      <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '4px 0 0' }}>
        {note}
      </p>
    </div>
  );
}
