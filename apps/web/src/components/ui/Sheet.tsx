'use client';

import type { JSX, ReactNode } from 'react';

import { Heading, Stack } from './primitives.js';

/** Our own sheet. The app never calls alert, confirm or prompt. */
export function Sheet({
  title,
  open,
  children,
  testId,
}: {
  title: string;
  open: boolean;
  children: ReactNode;
  testId?: string;
}): JSX.Element | null {
  if (!open) {
    return null;
  }
  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(12, 11, 10, 0.72)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
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
          borderRadius: 'var(--radius) var(--radius) 0 0',
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
