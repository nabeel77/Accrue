'use client';

import { useState, type JSX } from 'react';

import {
  Button,
  Explainer,
  Mono,
  Muted,
  Row,
  Sheet,
  Slider,
  Stack,
  Toggle,
} from '../../components/ui/index.js';
import { ADJUST_COPY } from '../../copy/deposit.js';
import { BORROW_MORE_COPY } from '../../copy/position.js';
import { borrowMoreLines } from '../../client/borrowMoreLines.js';
import { percent } from '../../client/format.js';
import type { StockRow } from './Deposit.js';

export interface Adjustments {
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growEnabled: boolean;
  readonly exitOnFlagEnabled: boolean;
  readonly overrideAccepted: boolean;
}

// The two controls the user never has to touch, plus everything curious behind Details.
export function AdjustSheet({
  open,
  stock,
  borrowRateBps,
  destinationName,
  destinationSymbol,
  tokens,
  yieldSource,
  adjustments,
  onChange,
  onClose,
}: {
  open: boolean;
  stock: StockRow;
  borrowRateBps: number;
  destinationName: string;
  destinationSymbol: string;
  // What the deposit being built would hold and owe, so the explainer shows its own numbers.
  tokens: number;
  yieldSource: string;
  adjustments: Adjustments | null;
  onChange: (value: Adjustments | null) => void;
  onClose: () => void;
}): JSX.Element {
  const stockPrice = Number(BigInt(stock.oraclePriceScaled)) / Number(2n ** 60n);
  const [override, setOverride] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const current: Adjustments = adjustments ?? {
    targetLtvBps: stock.targetLtvBps,
    protectLtvBps: stock.protectLtvBps,
    growEnabled: false,
    exitOnFlagEnabled: true,
    overrideAccepted: false,
  };
  const aboveDefault = current.targetLtvBps > stock.targetLtvBps;
  const overrideTyped = override.trim().toLowerCase() === ADJUST_COPY.overrideWord;

  function set(next: Partial<Adjustments>): void {
    onChange({ ...current, ...next, overrideAccepted: overrideTyped });
  }

  return (
    <Sheet title={ADJUST_COPY.title} open={open} testId="adjust-sheet" onClose={onClose}>
      <Stack gap={18}>
        <Slider
          testId="borrow-slider"
          numberTestId="borrow-percent"
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
          numberTestId="guard-percent"
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

        <Row style={{ alignItems: 'flex-start', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <Toggle
              testId="grow-toggle"
              label={BORROW_MORE_COPY.label}
              note={BORROW_MORE_COPY.note}
              checked={current.growEnabled}
              onChange={(value) => {
                set({ growEnabled: value });
              }}
            />
          </span>
          <Explainer
            title={BORROW_MORE_COPY.explain}
            testId="grow-explainer"
            lines={borrowMoreLines({
              tokens,
              priceNow: stockPrice,
              debtNow: (tokens * stockPrice * current.targetLtvBps) / 10_000,
              targetLtvBps: current.targetLtvBps,
              liquidationThresholdBps: stock.liquidationThresholdBps,
              stockSymbol: stock.symbol,
              destinationSymbol,
            })}
          />
        </Row>
        <Toggle
          testId="leave-toggle"
          label={ADJUST_COPY.leaveLabel}
          note={ADJUST_COPY.leaveNote}
          checked={current.exitOnFlagEnabled}
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
