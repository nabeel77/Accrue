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
    borderRadius: tone === 'primary' ? 999 : 'var(--radius)',
    padding: tone === 'link' ? 0 : '10px 16px',
    fontFamily: 'var(--font-text)',
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  } as const;

  const tones = {
    primary: {
      background: disabled
        ? 'rgba(255,255,255,.03)'
        : 'linear-gradient(rgba(12,20,17,.92), rgba(12,20,17,.92)) padding-box, linear-gradient(90deg, #6FD8B0, #37B98D 50%, #E2B871) border-box',
      color: disabled ? 'var(--color-text-muted)' : '#6FD8B0',
      border: `1px solid ${disabled ? 'rgba(255,255,255,.08)' : 'transparent'}`,
      boxShadow: disabled
        ? 'none'
        : '0 -1px 0 0 rgba(111,216,176,.9) inset, 0 0 0 1px rgba(55,185,141,.25), 0 14px 40px rgba(55,185,141,.18)',
    },
    quiet: {
      background: 'rgba(55,185,141,.12)',
      color: '#6FD8B0',
      border: '1px solid rgba(111,216,176,.45)',
      borderRadius: 999,
      boxShadow: '0 6px 20px rgba(55,185,141,.15)',
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
