'use client';

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';

import { COMMON } from '../../copy/common.js';
import { Button } from './Button.js';
import { Sheet } from './Sheet.js';
import { Stack } from './primitives.js';

const A_PHONE = '(max-width: 640px)';
const A_POINTER_THAT_HOVERS = '(hover: hover)';
const HOW_LONG_THE_NOTE_WAITS_BEFORE_CLOSING = 140;
const A_GAP_UNDER_THE_BUTTON = 6;
const ROOM_AT_THE_EDGE = 12;
const WIDEST_THE_NOTE_GETS = 340;

interface WhereTheNoteSits {
  readonly top: number;
  readonly right: number;
  readonly maxWidth: number;
  readonly below: boolean;
}

function noteBesideTheButton(box: DOMRect): WhereTheNoteSits {
  const roomBelow = window.innerHeight - box.bottom;
  const below = roomBelow > box.top;
  return {
    top: below ? box.bottom + A_GAP_UNDER_THE_BUTTON : 0,
    right: Math.max(ROOM_AT_THE_EDGE, window.innerWidth - box.right),
    maxWidth: Math.min(WIDEST_THE_NOTE_GETS, box.right - ROOM_AT_THE_EDGE),
    below,
  };
}

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
  const [where, setWhere] = useState<WhereTheNoteSits | null>(null);
  const aPhone = useMatches(A_PHONE);
  const anchor = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
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
      setWhere(null);
      return;
    }
    const place = (): void => {
      const box = anchor.current?.getBoundingClientRect();
      if (box !== undefined) {
        setWhere(noteBesideTheButton(box));
      }
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, aPhone]);

  useEffect(() => {
    if (!open || aPhone) {
      return;
    }
    const onClickElsewhere = (event: MouseEvent): void => {
      if (
        !(event.target instanceof Node) ||
        anchor.current?.contains(event.target) === true ||
        note.current?.contains(event.target) === true
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', onClickElsewhere);
    return () => {
      document.removeEventListener('mousedown', onClickElsewhere);
    };
  }, [open, aPhone]);

  const closeSoon = useCallback((): void => {
    if (!hoverOpens) {
      return;
    }
    stopClosing();
    closingSoon.current = setTimeout(() => {
      setOpen(false);
    }, HOW_LONG_THE_NOTE_WAITS_BEFORE_CLOSING);
  }, [hoverOpens, stopClosing]);

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
      onMouseLeave={closeSoon}
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

      {!open || aPhone || where === null
        ? null
        : createPortal(
            <span
              ref={note}
              role="note"
              data-testid={`${testId ?? 'explainer'}-note`}
              onMouseEnter={stopClosing}
              onMouseLeave={closeSoon}
              style={{
                position: 'fixed',
                top: where.below ? where.top : undefined,
                bottom: where.below
                  ? undefined
                  : window.innerHeight -
                    (anchor.current?.getBoundingClientRect().top ?? 0) +
                    A_GAP_UNDER_THE_BUTTON,
                right: where.right,
                zIndex: 60,
                width: 'max-content',
                maxWidth: where.maxWidth,
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
            </span>,
            document.body,
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
