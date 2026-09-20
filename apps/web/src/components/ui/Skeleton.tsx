import type { CSSProperties, JSX } from 'react';

export function Skeleton({
  width = '100%',
  height = 14,
  style,
  testId,
}: {
  width?: number | string;
  height?: number;
  style?: CSSProperties;
  testId?: string;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className="skeleton"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: 6,
        background: 'var(--color-raised-2)',
        ...style,
      }}
    />
  );
}

export function SkeletonRows({
  rows = 3,
  gap = 10,
  height = 14,
  testId,
}: {
  rows?: number;
  gap?: number;
  height?: number;
  testId?: string;
}): JSX.Element {
  return (
    <span
      aria-busy="true"
      data-testid={testId}
      style={{ display: 'flex', flexDirection: 'column', gap }}
    >
      {Array.from({ length: rows }, (unused, index) => (
        <Skeleton
          key={index}
          height={height}
          width={index === rows - 1 ? '60%' : '100%'}
        />
      ))}
    </span>
  );
}

export function SkeletonCard({
  lines = 3,
  testId,
}: {
  lines?: number;
  testId?: string;
}): JSX.Element {
  return (
    <span
      aria-busy="true"
      data-testid={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius)',
        padding: '12px 14px',
      }}
    >
      <Skeleton height={16} width="45%" />
      {Array.from({ length: lines }, (unused, index) => (
        <Skeleton key={index} height={12} width={index % 2 === 0 ? '85%' : '65%'} />
      ))}
    </span>
  );
}
