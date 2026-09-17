import type { JSX, ReactNode } from 'react';

export type BannerTone = 'caution' | 'danger' | 'notice';

export function Banner({
  tone,
  children,
  testId,
}: {
  tone: BannerTone;
  children: ReactNode;
  testId?: string;
}): JSX.Element {
  const border =
    tone === 'danger'
      ? 'var(--color-health-danger)'
      : tone === 'caution'
        ? 'var(--color-health-caution)'
        : 'var(--color-hairline)';
  return (
    <div
      data-testid={testId}
      role="status"
      style={{
        border: `1px solid ${border}`,
        background:
          tone === 'danger' ? 'var(--color-danger-surface)' : 'var(--color-raised)',
        borderRadius: 'var(--radius)',
        padding: '12px 16px',
        color: 'var(--color-text)',
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}
