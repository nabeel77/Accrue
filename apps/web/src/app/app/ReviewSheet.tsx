'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';

import { Button, Mono, Muted, Row, Sheet, Stack } from '../../components/ui/index.js';
import { COMMON } from '../../copy/common.js';
import { REVIEW_COPY } from '../../copy/deposit.js';
import { overrideLine, reviewLines } from '../../copy/review.js';
import { money, percent } from '../../client/format.js';
import type { Adjustments } from './AdjustSheet.js';
import type { StockRow } from './Deposit.js';

const SCALED_FRACTION_ONE = 2n ** 60n;

interface BuiltAnswer {
  readonly buildId?: string | null;
  readonly transaction?: readonly {
    transaction: string;
    bytes: number;
    uniqueAddresses: number;
  }[];
  readonly summary?: {
    stockSymbol: string;
    collateralAmountRaw: string;
    collateralUsdScaled: string;
    borrowUsdcRaw: string;
    borrowRateBps: number;
    destinationSymbol: string;
    quotedDestinationRaw: string;
    minimumDestinationRaw: string;
    destinationTargetRateBps: number;
    liquidationThresholdBps: number;
    targetLtvBps: number;
    protectLtvBps: number;
    oraclePriceScaled: string;
    collateralDecimals: number;
    slippageBps: number;
  };
  readonly refusal?: string;
  readonly message?: string;
}

export function ReviewSheet({
  open,
  stock,
  destinationSymbol,
  collateralAmountRaw,
  adjustments,
  onClose,
  onSigned,
  walletAddress,
  borrowUsd,
}: {
  open: boolean;
  stock: StockRow;
  destinationSymbol: string;
  collateralAmountRaw: string;
  adjustments: Adjustments | null;
  onClose: () => void;
  onSigned: (transactions: readonly string[], buildId?: string) => Promise<string>;
  walletAddress: string;
  borrowUsd: number;
  rawToWhole: (raw: string, decimals: number) => number;
}): JSX.Element {
  const [built, setBuilt] = useState<BuiltAnswer | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setBuilt(null);
    setSignature(null);
    void (async () => {
      const answer = await fetch('/api/positions/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stockMint: stock.mint,
          destinationSymbol,
          collateralAmountRaw,
          ...(adjustments === null
            ? {}
            : {
                targetLtvBps: adjustments.targetLtvBps,
                protectLtvBps: adjustments.protectLtvBps,
                growEnabled: adjustments.growEnabled,
                exitOnFlagEnabled: adjustments.exitOnFlagEnabled,
                overrideAccepted: adjustments.overrideAccepted,
              }),
        }),
      });
      setBuilt((await answer.json()) as BuiltAnswer);
    })();
  }, [open, stock.mint, destinationSymbol, collateralAmountRaw, adjustments]);

  const sign = useCallback(async (): Promise<void> => {
    if (built?.transaction === undefined) {
      return;
    }
    setBusy(true);
    try {
      setSignature(
        await onSigned(
          built.transaction.map((one) => one.transaction),
          built.buildId ?? undefined,
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [built, onSigned]);

  const summary = built?.summary;
  const price =
    summary === undefined
      ? 0
      : Number(BigInt(summary.oraclePriceScaled)) / Number(SCALED_FRACTION_ONE);
  const collateralUsd =
    summary === undefined
      ? 0
      : Number(BigInt(summary.collateralUsdScaled)) / Number(SCALED_FRACTION_ONE);
  const liquidationPrice =
    summary === undefined || summary.liquidationThresholdBps === 0
      ? 0
      : (price * summary.targetLtvBps) / summary.liquidationThresholdBps;
  const guardPrice =
    summary === undefined || summary.protectLtvBps === 0
      ? 0
      : (price * summary.targetLtvBps) / summary.protectLtvBps;

  const lines =
    summary === undefined
      ? []
      : reviewLines({
          collateralAmount: money(
            Number(BigInt(summary.collateralAmountRaw)) /
              10 ** summary.collateralDecimals,
            4,
          ),
          stockSymbol: summary.stockSymbol,
          collateralUsd: money(collateralUsd),
          borrowUsdc: money(Number(BigInt(summary.borrowUsdcRaw)) / 1e6),
          borrowRate: (summary.borrowRateBps / 100).toFixed(2),
          borrowCostYear: money(
            ((Number(BigInt(summary.borrowUsdcRaw)) / 1e6) * summary.borrowRateBps) /
              10_000,
          ),
          minimumDestinationAmount: money(
            Number(BigInt(summary.minimumDestinationRaw)) / 1e9,
            4,
          ),
          destinationSymbol: summary.destinationSymbol,
          quotedDestinationAmount: money(
            Number(BigInt(summary.quotedDestinationRaw)) / 1e9,
            4,
          ),
          destinationYield: (summary.destinationTargetRateBps / 100).toFixed(2),
          liquidationPrice: money(liquidationPrice),
          fallToLiquidation: (
            100 -
            (summary.targetLtvBps / summary.liquidationThresholdBps) * 100
          ).toFixed(0),
          currentPrice: money(price),
          guardPrice: money(guardPrice),
          fallToGuard: (
            100 -
            (summary.targetLtvBps / summary.protectLtvBps) * 100
          ).toFixed(0),
          protectAmount: money(borrowUsd * 0.2),
          distanceAfterStress: (
            100 -
            (summary.protectLtvBps / summary.liquidationThresholdBps) * 100
          ).toFixed(0),
          sellableTodayUsd: money(Number(BigInt(summary.quotedDestinationRaw)) / 1e9),
          slippageBps: `${summary.slippageBps}`,
          quoteAge: 'just now',
          netYear: money(
            (Number(BigInt(summary.borrowUsdcRaw)) / 1e6) *
              ((summary.destinationTargetRateBps - summary.borrowRateBps) / 10_000),
          ),
          netPercent: (
            (summary.targetLtvBps *
              (summary.destinationTargetRateBps - summary.borrowRateBps)) /
            1_000_000
          ).toFixed(2),
        });

  return (
    <Sheet title={REVIEW_COPY.title} open={open} testId="review-sheet">
      <Stack gap={14}>
        <Mono tone="muted">{COMMON.oneSignature}</Mono>

        {built === null ? <Muted>{COMMON.loading}</Muted> : null}
        {built?.refusal !== undefined ? (
          <Muted>{built.message ?? COMMON.tryAgain}</Muted>
        ) : null}

        {adjustments !== null && adjustments.targetLtvBps > stock.targetLtvBps ? (
          <p style={{ color: 'var(--color-text)', margin: 0 }}>
            {overrideLine(
              percent(adjustments.targetLtvBps, 0),
              percent(stock.targetLtvBps, 0),
            )}
          </p>
        ) : null}

        <Stack gap={10}>
          {lines.map((line) => (
            <p key={line} style={{ margin: 0, color: 'var(--color-text)', fontSize: 14 }}>
              {line}
            </p>
          ))}
        </Stack>

        {built?.transaction === undefined ? null : (
          <Row>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {REVIEW_COPY.walletAfter}
            </span>
            <Mono tone="secondary">
              {built.transaction
                .map((one) => `${one.bytes} bytes, ${one.uniqueAddresses} addresses`)
                .join(' then ')}
            </Mono>
          </Row>
        )}

        {signature === null ? (
          <Button
            testId="review-sign"
            disabled={built?.transaction === undefined || busy || walletAddress === ''}
            onClick={() => void sign()}
          >
            {REVIEW_COPY.sign}
          </Button>
        ) : (
          <Mono tone="accent" style={{ wordBreak: 'break-all' }}>
            <span data-testid="open-signature">{signature}</span>
          </Mono>
        )}
        <Button tone="link" onClick={onClose}>
          {COMMON.close}
        </Button>
      </Stack>
    </Sheet>
  );
}
