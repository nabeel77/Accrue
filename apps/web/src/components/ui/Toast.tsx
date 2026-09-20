'use client';

import { useEffect, type JSX } from 'react';

export type ToastTone = 'confirmation' | 'failure';

const HOW_LONG_A_TOAST_STAYS = 6_000;

export function Toast({
  message,
  tone,
  onDone,
  testId,
}: {
  message: string | null;
  tone: ToastTone;
  onDone: () => void;
  testId?: string;
}): JSX.Element | null {
  useEffect(() => {
    if (message === null) {
      return;
    }
    const goes = setTimeout(onDone, HOW_LONG_A_TOAST_STAYS);
    return () => {
      clearTimeout(goes);
    };
  }, [message, onDone]);

  if (message === null) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      onClick={onDone}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 40,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          maxWidth: 'min(420px, 100%)',
          textAlign: 'center',
          background: 'var(--color-panel)',
          border: `1px solid ${
            tone === 'failure'
              ? 'var(--color-health-caution)'
              : 'var(--color-accent-deeper)'
          }`,
          borderRadius: 'var(--radius)',
          padding: '16px 20px',
          color: 'var(--color-text)',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
        }}
      >
        {message}
      </div>
    </div>
  );
}
