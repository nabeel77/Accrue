'use client';

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { COMMON } from '../../copy/common.js';
import { Button } from './Button.js';
import { Sheet } from './Sheet.js';
import { Stack } from './primitives.js';

const A_PHONE = '(max-width: 640px)';
const A_POINTER_THAT_HOVERS = '(hover: hover)';
const HOW_LONG_THE_NOTE_WAITS_BEFORE_CLOSING = 140;

export interface ExplainerLine {
  readonly lead: string | null;
  readonly text: string;
}

function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const watcher = window.matchMedia(query);
    const look = (): void => {
      setMatches(watcher.matches);
    };
    look();
    watcher.addEventListener('change', look);
    return () => {
      watcher.removeEventListener('change', look);
    };
  }, [query]);
  return matches;
}

function Lines({ lines }: { lines: readonly ExplainerLine[] }): JSX.Element {
  return (
    <Stack gap={10}>
      {lines.map((line) => (
        <p
          key={`${line.lead ?? ''}${line.text}`}
          style={{ margin: 0, color: 'var(--color-text)', fontSize: 14, lineHeight: 1.5 }}
        >
          {line.lead === null ? null : (
            <strong style={{ color: 'var(--color-accent)', fontWeight: 600 }}>
              {`${line.lead} `}
            </strong>
          )}
          {line.text}
        </p>
      ))}
    </Stack>
  );
}

export function Explainer({
  title,
  lines,
  testId,
}: {
  title: string;
  lines: readonly ExplainerLine[];
  testId?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const aPhone = useMatches(A_PHONE);
  const anchor = useRef<HTMLSpanElement>(null);
  const closingSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverOpens = useMatches(A_POINTER_THAT_HOVERS) && !aPhone;

  const stopClosing = useCallback((): void => {
    if (closingSoon.current !== null) {
      clearTimeout(closingSoon.current);
      closingSoon.current = null;
    }
  }, []);

  useEffect(() => stopClosing, [stopClosing]);

  useEffect(() => {
    if (!open || aPhone) {
      return;
    }
    const onClickElsewhere = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || anchor.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', onClickElsewhere);
    return () => {
      document.removeEventListener('mousedown', onClickElsewhere);
    };
  }, [open, aPhone]);

  return (
    <span
      ref={anchor}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => {
        if (hoverOpens) {
          stopClosing();
          setOpen(true);
        }
      }}
      onMouseLeave={() => {
        if (hoverOpens) {
          stopClosing();
          closingSoon.current = setTimeout(() => {
            setOpen(false);
          }, HOW_LONG_THE_NOTE_WAITS_BEFORE_CLOSING);
        }
      }}
    >
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        data-testid={testId}
        onClick={() => {
          setOpen(!open);
        }}
        onFocus={() => {
          stopClosing();
          setOpen(true);
        }}
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          border: '1px solid var(--color-hairline)',
          background: 'var(--color-raised)',
          color: 'var(--color-text-secondary)',
          fontSize: 12,
          lineHeight: '18px',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        i
      </button>

      {!open || aPhone ? null : (
        <span
          role="note"
          data-testid={`${testId ?? 'explainer'}-note`}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            paddingTop: 6,
            zIndex: 30,
            width: 'max-content',
            maxWidth: 'min(340px, calc(100vw - 48px))',
          }}
        >
          <span
            style={{
              display: 'block',
              background: 'var(--color-panel)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius)',
              padding: 16,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
            }}
          >
            <Lines lines={lines} />
          </span>
        </span>
      )}

      {!open || !aPhone ? null : (
        <Sheet
          title={title}
          open
          testId={`${testId ?? 'explainer'}-sheet`}
          onClose={() => {
            setOpen(false);
          }}
        >
          <Stack gap={12}>
            <Lines lines={lines} />
            <Button
              tone="link"
              onClick={() => {
                setOpen(false);
              }}
            >
              {COMMON.close}
            </Button>
          </Stack>
        </Sheet>
      )}
    </span>
  );
}
