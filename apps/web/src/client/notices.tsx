'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type NoticeTone = 'confirmation' | 'failure' | 'notice';

export interface ANotice {
  readonly id: number;
  readonly message: string;
  readonly tone: NoticeTone;
}

const HOW_LONG_A_NOTICE_STAYS = 5_000;

const Notices = createContext<{ say: (message: string, tone: NoticeTone) => void }>({
  say: () => undefined,
});

export function useNotices(): { say: (message: string, tone: NoticeTone) => void } {
  return useContext(Notices);
}

const EDGE: Record<NoticeTone, string> = {
  confirmation: 'var(--color-accent)',
  failure: 'var(--color-health-danger)',
  notice: 'var(--color-gold)',
};

function Note({
  notice,
  onClose,
}: {
  notice: ANotice;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`notice-${notice.tone}`}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        width: 'min(380px, calc(100vw - 32px))',
        background: 'var(--color-panel)',
        border: '1px solid var(--color-hairline)',
        borderLeft: `3px solid ${EDGE[notice.tone]}`,
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        color: 'var(--color-text)',
        fontSize: 14,
        lineHeight: 1.5,
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
        animation: 'acr-notice 260ms cubic-bezier(.2,.8,.2,1) both',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{notice.message}</span>
      <button
        type="button"
        aria-label="Close"
        data-testid="notice-close"
        onClick={onClose}
        style={{
          flex: 'none',
          width: 22,
          height: 22,
          padding: 0,
          border: 'none',
          background: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: '20px',
        }}
      >
        ×
      </button>
    </div>
  );
}

export function NoticeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [notices, setNotices] = useState<readonly ANotice[]>([]);

  const forget = useCallback((id: number): void => {
    setNotices((current) => current.filter((one) => one.id !== id));
  }, []);

  const say = useCallback(
    (message: string, tone: NoticeTone): void => {
      const id = Date.now() + Math.random();
      setNotices((current) => [...current, { id, message, tone }]);
      setTimeout(() => {
        forget(id);
      }, HOW_LONG_A_NOTICE_STAYS);
    },
    [forget],
  );

  const speaker = useMemo(() => ({ say }), [say]);

  return (
    <Notices.Provider value={speaker}>
      {children}
      {typeof document === 'undefined' || notices.length === 0
        ? null
        : createPortal(
            <div
              style={{
                position: 'fixed',
                top: 16,
                right: 16,
                zIndex: 80,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                pointerEvents: 'none',
              }}
            >
              {notices.map((notice) => (
                <Note
                  key={notice.id}
                  notice={notice}
                  onClose={() => {
                    forget(notice.id);
                  }}
                />
              ))}
            </div>,
            document.body,
          )}
    </Notices.Provider>
  );
}
