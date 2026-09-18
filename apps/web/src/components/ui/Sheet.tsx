'use client';

import { useEffect, type JSX, type ReactNode } from 'react';

import { Heading, Stack } from './primitives.js';

// Our own sheet.
export function Sheet({
  title,
  open,
  children,
  testId,
  onClose,
}: {
  title: string;
  open: boolean;
  children: ReactNode;
  testId?: string;
  onClose?: () => void;
}): JSX.Element | null {
  useEffect(() => {
    if (!open || onClose === undefined) {
      return;
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('keydown', onEscape);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }
  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-label={title}
      onClick={(event) => {
        if (onClose !== undefined && event.target === event.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--color-ground) 72%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 20,
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--color-panel)',
          border: '1px solid var(--color-hairline)',
          borderRadius: 'var(--radius)',
          padding: 24,
        }}
      >
        <Stack gap={16}>
          <Heading level={2}>{title}</Heading>
          {children}
        </Stack>
      </div>
    </div>
  );
}
