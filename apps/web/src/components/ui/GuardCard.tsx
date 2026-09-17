'use client';

import { useState, type JSX } from 'react';

import { POSITION_COPY } from '../../copy/position.js';
import { Button } from './Button.js';
import { Mono, Panel, Row, Stack } from './primitives.js';

export interface GuardCardProps {
  readonly status: 'healthy' | 'caution' | 'danger';
  readonly repaysAt: string;
  readonly lastAction: string;
  readonly keepersLastHour: string;
  readonly parameters: readonly { label: string; value: string }[];
  readonly onProtectNow?: () => void;
  readonly onChange?: () => void;
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
          </span>
          {props.onProtectNow === undefined ? null : (
            <Button tone="quiet" onClick={props.onProtectNow} testId="protect-now">
              {POSITION_COPY.protectNow}
            </Button>
          )}
        </Row>

        <Row>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {POSITION_COPY.repaysAt}
          </span>
          <Mono>{props.repaysAt}</Mono>
        </Row>
        <Row>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {POSITION_COPY.lastGuardAction}
          </span>
          <Mono>{props.lastAction}</Mono>
        </Row>
        <Row>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {POSITION_COPY.keepersSeen}
          </span>
          <Mono>{props.keepersLastHour}</Mono>
        </Row>

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
                <Button tone="link" onClick={props.onChange}>
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
