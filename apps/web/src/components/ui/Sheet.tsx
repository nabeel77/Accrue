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
        background: 'rgba(6,5,5,0.78)',
        backdropFilter: 'blur(4px)',
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
          background: '#121110',
          border: '1px solid #22201D',
          borderRadius: 16,
          padding: 'clamp(20px,3vw,28px)',
          animation: 'acr-sheet 240ms ease-out both',
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
