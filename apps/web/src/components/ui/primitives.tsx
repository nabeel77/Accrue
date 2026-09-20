import type { CSSProperties, JSX, ReactNode } from 'react';

export const CENTRED_SCREEN: CSSProperties = { width: '100%', margin: 'auto' };

export function Panel({
  children,
  style,
  testId,
}: {
  children: ReactNode;
  style?: CSSProperties;
  testId?: string;
}): JSX.Element {
  return (
    <section
      data-testid={testId}
      className="acr-card"
      style={{ padding: '20px', ...style }}
    >
      {children}
    </section>
  );
}

export function Stack({
  children,
  gap = 12,
  className,
  style,
  testId,
}: {
  children: ReactNode;
  gap?: number;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap, ...style }}
    >
      {children}
    </div>
  );
}

export function Row({
  children,
  gap = 12,
  style,
  testId,
}: {
  children: ReactNode;
  gap?: number;
  style?: CSSProperties;
  testId?: string;
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Every number, address, percentage and time.
export function Mono({
  children,
  tone = 'text',
  style,
  testId,
}: {
  children: ReactNode;
  tone?: 'text' | 'secondary' | 'muted' | 'gold' | 'accent' | 'caution';
  style?: CSSProperties;
  testId?: string;
}): JSX.Element {
  const colour =
    tone === 'caution'
      ? 'var(--color-health-caution)'
      : tone === 'gold'
        ? 'var(--color-gold)'
        : tone === 'accent'
          ? 'var(--color-accent)'
          : tone === 'secondary'
            ? 'var(--color-text-secondary)'
            : tone === 'muted'
              ? 'var(--color-text-muted)'
              : 'var(--color-text)';
  return (
    <span
      data-testid={testId}
      style={{
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        color: colour,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Muted({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}): JSX.Element {
  return (
    <p data-testid={testId} style={{ color: 'var(--color-text-muted)', margin: 0 }}>
      {children}
    </p>
  );
}

export function Secondary({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}): JSX.Element {
  return (
    <p data-testid={testId} style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
      {children}
    </p>
  );
}

export function Heading({
  children,
  level = 2,
  testId,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3;
  testId?: string;
}): JSX.Element {
  const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  if (level === 1) {
    return (
      <h1
        data-testid={testId}
        className="acr-title"
        style={{
          margin: 0,
          fontSize: 'clamp(26px,3vw,34px)',
          fontWeight: 300,
          letterSpacing: '-0.03em',
        }}
      >
        {children}
      </h1>
    );
  }
  return (
    <Tag
      data-testid={testId}
      style={{
        fontSize: level === 2 ? 20 : 16,
        fontWeight: 500,
        margin: 0,
        color: 'var(--color-text)',
      }}
    >
      {children}
    </Tag>
  );
}

export function Eyebrow({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span
      style={{
        fontSize: 11,
        letterSpacing: '.12em',
        textTransform: 'uppercase',
        color: 'var(--color-text-muted)',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
