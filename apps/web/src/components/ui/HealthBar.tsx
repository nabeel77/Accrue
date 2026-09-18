import type { JSX } from 'react';

import { Mono, Row } from './primitives.js';

const BASIS_POINTS = 10_000;

// The three zones, and jade never appears here.
export function HealthBar({
  fillBps,
  zone,
  label,
}: {
  fillBps: number;
  zone: 'healthy' | 'caution' | 'danger';
  label?: string;
}): JSX.Element {
  const colour =
    zone === 'danger'
      ? 'var(--color-health-danger)'
      : zone === 'caution'
        ? 'var(--color-health-caution)'
        : 'var(--color-health-healthy)';
  return (
    <div data-testid="health-bar" data-zone={zone}>
      <Row>
        <span style={{ color: 'var(--color-text-secondary)' }}>{label ?? 'Health'}</span>
        <Mono tone="secondary">{(fillBps / 100).toFixed(1)}%</Mono>
      </Row>
      <div
        style={{
          marginTop: 8,
          height: 6,
          borderRadius: 'var(--radius-pill)',
          background: 'var(--color-hairline)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min((fillBps / BASIS_POINTS) * 100, 100)}%`,
            height: '100%',
            background: colour,
          }}
        />
      </div>
    </div>
  );
}
