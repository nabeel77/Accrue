'use client';

import type { JSX, ReactNode } from 'react';

export type ButtonTone = 'primary' | 'quiet' | 'link';

export function Button({
  children,
  onClick,
  tone = 'primary',
  disabled = false,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  testId?: string;
}): JSX.Element {
  const base = {
    borderRadius: 'var(--radius)',
    padding: tone === 'link' ? 0 : '10px 16px',
    fontFamily: 'var(--font-text)',
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  } as const;

  const tones = {
    primary: {
      background: 'var(--color-accent)',
      color: 'var(--color-ground)',
      border: '1px solid var(--color-accent)',
    },
    quiet: {
      background: 'var(--color-raised)',
      color: 'var(--color-text)',
      border: '1px solid var(--color-hairline)',
    },
    link: {
      background: 'transparent',
      color: 'var(--color-text-muted)',
      border: 'none',
      textDecoration: 'underline',
    },
  } as const;

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{ ...base, ...tones[tone] }}
    >
      {children}
    </button>
  );
}
