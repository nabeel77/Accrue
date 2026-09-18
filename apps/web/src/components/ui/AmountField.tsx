'use client';

import type { JSX } from 'react';

import { AMOUNT_FIELD_COPY } from '../../copy/common.js';
import { Button } from './Button.js';
import { Mono, Muted, Row, Stack } from './primitives.js';

const A_HALF = 0.5;
const SHOWN_DECIMALS = 6;

export interface AmountFieldProps {
  readonly label: string;
  readonly symbol: string;
  // What the reader may spend, in whole tokens, and the one line that says where it comes from.
  readonly availableWhole: number;
  readonly availableLabel: string;
  readonly decimals: number;
  readonly value: string;
  readonly note?: string;
  readonly testId: string;
  onChange: (value: string) => void;
}

// Rounded down, always: MAX must never offer a hair more than the wallet or the loan holds.
function trimmed(value: number, decimals: number): string {
  const places = Math.min(decimals, SHOWN_DECIMALS);
  const step = 10 ** places;
  const floored = Math.floor(value * step) / step;
  return floored.toFixed(places).replace(/\.?0+$/u, '');
}

export function AmountField({
  label,
  symbol,
  availableWhole,
  availableLabel,
  decimals,
  value,
  note,
  testId,
  onChange,
}: AmountFieldProps): JSX.Element {
  const typed = Number(value);
  const tooMuch = Number.isFinite(typed) && typed > availableWhole;

  return (
    <Stack gap={8}>
      <Row>
        <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
        <Mono tone="secondary" testId={`${testId}-available`}>
          {availableLabel} {trimmed(availableWhole, decimals)} {symbol}
        </Mono>
      </Row>
      <Row style={{ gap: 8 }}>
        <input
          data-testid={testId}
          value={value}
          inputMode="decimal"
          placeholder="0.00"
          aria-label={label}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--color-raised-2)',
            color: 'var(--color-text)',
            border: '1px solid',
            borderColor: tooMuch ? 'var(--color-health-danger)' : 'var(--color-hairline)',
            borderRadius: 'var(--radius)',
            padding: '12px 14px',
            minHeight: 44,
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 18,
          }}
        />
        <Mono tone="secondary">{symbol}</Mono>
        <Button
          tone="quiet"
          testId={`${testId}-half`}
          onClick={() => {
            onChange(trimmed(availableWhole * A_HALF, decimals));
          }}
        >
          {AMOUNT_FIELD_COPY.half}
        </Button>
        <Button
          tone="quiet"
          testId={`${testId}-max`}
          onClick={() => {
            onChange(trimmed(availableWhole, decimals));
          }}
        >
          {AMOUNT_FIELD_COPY.max}
        </Button>
      </Row>
      {note === undefined ? null : <Muted>{note}</Muted>}
      {tooMuch ? (
        <Muted testId={`${testId}-too-much`}>
          {AMOUNT_FIELD_COPY.moreThanYouHave(trimmed(availableWhole, decimals), symbol)}
        </Muted>
      ) : null}
    </Stack>
  );
}
