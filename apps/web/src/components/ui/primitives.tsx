import type { CSSProperties, JSX, ReactNode } from 'react';

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
      style={{
        background: 'var(--color-panel)',
        border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius)',
        padding: '20px',
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function Stack({
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

/** Every number, address, percentage and time. Tabular so columns line up. */
export function Mono({
  children,
  tone = 'text',
  style,
  testId,
}: {
  children: ReactNode;
  tone?: 'text' | 'secondary' | 'muted' | 'gold' | 'accent';
  style?: CSSProperties;
  testId?: string;
}): JSX.Element {
  const colour =
    tone === 'gold'
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

export function Secondary({ children }: { children: ReactNode }): JSX.Element {
  return <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>{children}</p>;
}

export function Heading({
  children,
  level = 2,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3;
}): JSX.Element {
  const size = level === 1 ? 28 : level === 2 ? 20 : 16;
  const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  return (
    <Tag
      style={{ fontSize: size, fontWeight: 500, margin: 0, color: 'var(--color-text)' }}
    >
      {children}
    </Tag>
  );
}
