'use client';

import type { JSX } from 'react';

import { Row } from './primitives.js';

export function Toggle({
  label,
  note,
  checked,
  onChange,
  testId,
}: {
  label: string;
  note: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId?: string;
}): JSX.Element {
  return (
    <div>
      <Row>
        <label style={{ color: 'var(--color-text)', display: 'flex', gap: 10 }}>
          <input
            type="checkbox"
            data-testid={testId}
            checked={checked}
            onChange={(event) => {
              onChange(event.target.checked);
            }}
            style={{ accentColor: 'var(--color-accent)' }}
          />
          {label}
        </label>
      </Row>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '4px 0 0' }}>
        {note}
      </p>
    </div>
  );
}
