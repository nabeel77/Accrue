'use client';

import { useState, type JSX } from 'react';

import { POSITION_COPY } from '../../copy/position.js';
import { Button } from './Button.js';
import { Mono, Muted, Panel, Row, Stack } from './primitives.js';

export interface GuardCardProps {
  readonly status: 'healthy' | 'caution' | 'danger';
  // The guard's level with the position's own loan to value beside it.
  readonly repaysAt: string;
  // When a keeper last looked at this position, and which one.
  readonly lastChecked: string;
  // Said out loud when nothing has looked for long enough to matter.
  readonly noKeeperSeen: string | null;
  // What the guard has actually done to this position, and when it may act again.
  readonly repaid: string;
  // Whether this position borrows more when the stock rises, said without opening anything.
  readonly whatItDoes: string;
  readonly parameters: readonly { label: string; value: string }[];
  readonly onProtectNow?: () => void;
  readonly onChange?: () => void;
  readonly protectNowIsPointless?: boolean;
  // Said while the guard is between turns. The owner may still act, so nothing is disabled.
  readonly waitingFor?: string | null;
}

export function GuardCard(props: GuardCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const dot =
    props.status === 'danger'
      ? 'var(--color-health-danger)'
      : props.status === 'caution'
        ? 'var(--color-health-caution)'
        : 'var(--color-accent)';

  return (
    <Panel>
      <Stack gap={14}>
        <Row>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              data-testid="guard-status-dot"
              style={{ width: 8, height: 8, borderRadius: 999, background: dot }}
            />
            <strong style={{ fontWeight: 500 }}>{POSITION_COPY.guardCardTitle}</strong>
            <Mono tone="secondary" testId="guard-what-it-does" style={{ fontSize: 12 }}>
              {props.whatItDoes}
            </Mono>
          </span>
          {props.onProtectNow === undefined ? null : (
            <Button
              tone="quiet"
              onClick={props.onProtectNow}
              testId="guard-protect-now"
              disabled={props.protectNowIsPointless === true}
            >
              {POSITION_COPY.protectNow}
            </Button>
          )}
        </Row>
        {props.protectNowIsPointless === true ? (
          <Muted testId="protect-now-pointless">{POSITION_COPY.nothingToRepay}</Muted>
        ) : null}
        {(props.waitingFor ?? null) === null ? null : (
          <Muted testId="guard-interval">{props.waitingFor}</Muted>
        )}

        <Row>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {POSITION_COPY.repaysAt}
          </span>
          <Mono testId="guard-repays-at">{props.repaysAt}</Mono>
        </Row>
        <Row>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {POSITION_COPY.lastChecked}
          </span>
          <Mono testId="guard-last-checked">{props.lastChecked}</Mono>
        </Row>
        <Row>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {POSITION_COPY.repaid}
          </span>
          <Mono testId="guard-repaid">{props.repaid}</Mono>
        </Row>
        {props.noKeeperSeen === null ? null : (
          <Mono tone="caution" testId="guard-no-keeper">
            {props.noKeeperSeen}
          </Mono>
        )}

        <div>
          <button
            type="button"
            data-testid="guard-details"
            onClick={() => {
              setOpen(!open);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {POSITION_COPY.details}
          </button>
          {open ? (
            <Stack gap={8} style={{ marginTop: 10 }}>
              {props.parameters.map((entry) => (
                <Row key={entry.label}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    {entry.label}
                  </span>
                  <Mono tone="secondary">{entry.value}</Mono>
                </Row>
              ))}
              {props.onChange === undefined ? null : (
                <Button tone="link" onClick={props.onChange} testId="guard-change">
                  {POSITION_COPY.change}
                </Button>
              )}
            </Stack>
          ) : null}
        </div>
      </Stack>
    </Panel>
  );
}
