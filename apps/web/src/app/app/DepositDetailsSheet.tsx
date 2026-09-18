'use client';

import Link from 'next/link';
import type { JSX } from 'react';

import { Button, Mono, Muted, Row, Sheet, Stack } from '../../components/ui/index.js';
import { COMMON } from '../../copy/common.js';
import { DEPOSIT_COPY } from '../../copy/deposit.js';
import { YIELD_LINE } from '../../copy/banners.js';
import { howLongAgo, money, percent } from '../../client/format.js';
import type { DepositSizing } from '@accrue/core/deposit';

const A_SECOND = 1_000;

interface PositionSizeLimits {
  readonly smallestUsd: number;
  readonly largestUsd: number;
}

export interface OpenPositionSettings {
  readonly href: string;
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growEnabled: boolean;
}

function QuoteRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}): JSX.Element {
  return (
    <Row>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <Mono testId={testId}>{value}</Mono>
    </Row>
  );
}

// Everything the card does not say, in the quote style: the label left and the number right.
export function DepositDetailsSheet({
  open,
  stockSymbol,
  destinationSymbol,
  sizing,
  quotedAtMilliseconds,
  protectLtvBps,
  liquidationFallBps,
  limits,
  openPosition,
  onAdjust,
  onClose,
}: {
  open: boolean;
  stockSymbol: string;
  destinationSymbol: string;
  sizing: DepositSizing;
  quotedAtMilliseconds: number | null;
  protectLtvBps: number;
  liquidationFallBps: number;
  limits: PositionSizeLimits | null;
  // Set when this deposit grows a position the wallet already holds, and then the guard is that
  // position's own and is only read here.
  openPosition: OpenPositionSettings | null;
  onAdjust: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet
      title={DEPOSIT_COPY.details}
      open={open}
      testId="deposit-details-sheet"
      onClose={onClose}
    >
      <Stack gap={10}>
        <QuoteRow
          label={DEPOSIT_COPY.depositRow}
          value={`${money(sizing.depositUsd)} USD`}
          testId="details-deposit"
        />
        <QuoteRow
          label={DEPOSIT_COPY.borrowedRow}
          value={`${money(sizing.borrowUsd)} USDC`}
          testId="details-borrowed"
        />
        <QuoteRow
          label={DEPOSIT_COPY.intoRow}
          value={
            sizing.destinationAmount === null
              ? COMMON.missingValue
              : `${money(sizing.destinationAmount)} ${destinationSymbol}`
          }
          testId="details-into"
        />
        <QuoteRow
          label={DEPOSIT_COPY.destinationRateRow(destinationSymbol)}
          value={YIELD_LINE.aYear(percent(sizing.destinationRateBps))}
          testId="details-destination-rate"
        />
        <QuoteRow
          label={DEPOSIT_COPY.loanRateRow}
          value={YIELD_LINE.aYear(percent(sizing.borrowRateBps))}
          testId="details-loan-rate"
        />
        <QuoteRow
          label={DEPOSIT_COPY.netRow}
          value={YIELD_LINE.aYear(percent(sizing.netYieldBps))}
          testId="details-net"
        />
        <QuoteRow
          label={DEPOSIT_COPY.guardRepaysAtRow}
          value={DEPOSIT_COPY.loanToValueLevel(percent(protectLtvBps, 0))}
          testId="details-guard"
        />
        <QuoteRow
          label={DEPOSIT_COPY.liquidationRow(stockSymbol)}
          value={DEPOSIT_COPY.fallOf(percent(liquidationFallBps, 0))}
          testId="details-liquidation"
        />
        <QuoteRow
          label={DEPOSIT_COPY.quoteRow}
          value={
            quotedAtMilliseconds === null
              ? COMMON.missingValue
              : howLongAgo((Date.now() - quotedAtMilliseconds) / A_SECOND)
          }
          testId="details-quote-age"
        />
        {limits === null ? null : (
          <QuoteRow
            label={DEPOSIT_COPY.positionSizeRow}
            value={DEPOSIT_COPY.sizeRange(
              money(limits.smallestUsd, 0),
              money(limits.largestUsd, 0),
            )}
            testId="details-size-limit"
          />
        )}

        <Muted>{DEPOSIT_COPY.oneSignatureNote}</Muted>
        {openPosition === null ? (
          <div>
            <Button tone="link" testId="adjust" onClick={onAdjust}>
              {DEPOSIT_COPY.adjust}
            </Button>
          </div>
        ) : (
          <Stack gap={10}>
            <QuoteRow
              label={DEPOSIT_COPY.guardRepaysAtRowForTheOpenPosition}
              value={DEPOSIT_COPY.loanToValueLevel(
                percent(openPosition.protectLtvBps, 0),
              )}
              testId="position-guard"
            />
            <QuoteRow
              label={DEPOSIT_COPY.borrowMoreRow}
              value={
                openPosition.growEnabled
                  ? DEPOSIT_COPY.borrowMoreOn
                  : DEPOSIT_COPY.borrowMoreOff
              }
              testId="position-borrow-more"
            />
            <QuoteRow
              label={DEPOSIT_COPY.targetRow}
              value={percent(openPosition.targetLtvBps, 0)}
              testId="position-target"
            />
            <Muted testId="guard-stays">{DEPOSIT_COPY.theseBelongToYourPosition}</Muted>
            <Link href={openPosition.href} data-testid="details-open-position">
              {DEPOSIT_COPY.positionName(stockSymbol, destinationSymbol)}
            </Link>
          </Stack>
        )}
        <Button tone="link" onClick={onClose}>
          {COMMON.close}
        </Button>
      </Stack>
    </Sheet>
  );
}
