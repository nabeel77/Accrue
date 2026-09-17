'use client';

import { useState, type JSX } from 'react';

import {
  Button,
  Mono,
  Muted,
  Row,
  Sheet,
  Slider,
  Stack,
  Toggle,
} from '../../components/ui/index.js';
import { ADJUST_COPY } from '../../copy/deposit.js';
import { percent } from '../../client/format.js';
import type { StockRow } from './Deposit.js';

export interface Adjustments {
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growEnabled: boolean;
  readonly exitOnFlagEnabled: boolean;
  readonly overrideAccepted: boolean;
}

/** The two controls the user never has to touch, plus everything curious behind Details. */
export function AdjustSheet({
  open,
  stock,
  borrowRateBps,
  destinationName,
  yieldSource,
  adjustments,
  onChange,
  onClose,
}: {
  open: boolean;
  stock: StockRow;
  borrowRateBps: number;
  destinationName: string;
  yieldSource: string;
  adjustments: Adjustments | null;
  onChange: (value: Adjustments | null) => void;
  onClose: () => void;
}): JSX.Element {
  const [override, setOverride] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const current: Adjustments = adjustments ?? {
    targetLtvBps: stock.targetLtvBps,
    protectLtvBps: stock.protectLtvBps,
    growEnabled: true,
    exitOnFlagEnabled: true,
    overrideAccepted: false,
  };
  const aboveDefault = current.targetLtvBps > stock.targetLtvBps;
  const overrideTyped = override.trim().toLowerCase() === ADJUST_COPY.overrideWord;

  function set(next: Partial<Adjustments>): void {
    onChange({ ...current, ...next, overrideAccepted: overrideTyped });
  }

  return (
    <Sheet title={ADJUST_COPY.title} open={open} testId="adjust-sheet">
      <Stack gap={18}>
        <Slider
          testId="borrow-slider"
          label={ADJUST_COPY.borrowLabel}
          value={current.targetLtvBps}
          min={500}
          max={stock.maxLoanToValueBps}
          step={100}
          onChange={(value) => {
            set({ targetLtvBps: value });
          }}
          readout={`${percent(current.targetLtvBps, 0)} LTV`}
          isDefault={current.targetLtvBps === stock.targetLtvBps}
          onReset={() => {
            onChange(null);
          }}
          note={ADJUST_COPY.borrowNote}
        />

        {aboveDefault ? (
          <Stack gap={8}>
            <Muted>{ADJUST_COPY.overridePrompt}</Muted>
            <input
              data-testid="override"
              value={override}
              onChange={(event) => {
                setOverride(event.target.value);
                set({});
              }}
              style={{
                background: 'var(--color-raised-2)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius)',
                padding: '8px 10px',
                color: 'var(--color-text)',
              }}
            />
          </Stack>
        ) : null}

        <Slider
          testId="guard-slider"
          label={ADJUST_COPY.guardLabel}
          value={current.protectLtvBps}
          min={current.targetLtvBps + 500}
          max={Math.max(stock.liquidationThresholdBps - 500, current.targetLtvBps + 500)}
          step={100}
          onChange={(value) => {
            set({ protectLtvBps: value });
          }}
          readout={`${percent(current.protectLtvBps, 0)} loan to value`}
          isDefault={current.protectLtvBps === stock.protectLtvBps}
          onReset={() => {
            onChange(null);
          }}
          note={ADJUST_COPY.guardNote}
        />

        <Toggle
          testId="grow-toggle"
          label={ADJUST_COPY.growLabel}
          note={ADJUST_COPY.growNote}
          checked={current.growEnabled}
          isDefault={current.growEnabled}
          onChange={(value) => {
            set({ growEnabled: value });
          }}
        />
        <Toggle
          testId="leave-toggle"
          label={ADJUST_COPY.leaveLabel}
          note={ADJUST_COPY.leaveNote}
          checked={current.exitOnFlagEnabled}
          isDefault={current.exitOnFlagEnabled}
          onChange={(value) => {
            set({ exitOnFlagEnabled: value });
          }}
        />

        <div>
          <Button
            tone="link"
            testId="adjust-details"
            onClick={() => {
              setDetailsOpen(!detailsOpen);
            }}
          >
            {ADJUST_COPY.detailsLabel}
          </Button>
          {detailsOpen ? (
            <Stack gap={8} style={{ marginTop: 10 }}>
              <Row>
                <span style={{ color: 'var(--color-text-secondary)' }}>Borrow rate</span>
                <Mono>{percent(borrowRateBps)}</Mono>
              </Row>
              <Row>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Market maximum
                </span>
                <Mono>{percent(stock.maxLoanToValueBps, 0)}</Mono>
              </Row>
              <Row>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Liquidation threshold
                </span>
                <Mono>{percent(stock.liquidationThresholdBps, 0)}</Mono>
              </Row>
              <Row>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {destinationName}
                </span>
                <Mono tone="secondary">{yieldSource}</Mono>
              </Row>
            </Stack>
          ) : null}
        </div>

        <Button testId="adjust-done" onClick={onClose}>
          {ADJUST_COPY.done}
        </Button>
      </Stack>
    </Sheet>
  );
}
