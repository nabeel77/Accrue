'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';

import { quoteAgeSeconds, theQuoteIsStale } from '@accrue/core/freshness';

import {
  Banner,
  Button,
  Heading,
  Mono,
  Row,
  Sheet,
  SkeletonRows,
  Stack,
  TransactionLink,
} from '../../components/ui/index.js';
import { COMMON } from '../../copy/common.js';
import { QUOTE_COPY, REVIEW_COPY } from '../../copy/deposit.js';
import { overrideLine, reviewLines } from '../../copy/review.js';
import { howLongAgo, money, percent } from '../../client/format.js';
import {
  failureOf,
  readFailure,
  readTheAnswer,
  SubmissionRefused,
  theWalletSaidNo,
  type FailureAnswer,
  type ReadableFailure,
} from '../../client/failures.js';
import { FAILURE_COPY } from '../../copy/errors.js';
import { useSession } from '../../client/session.js';
import type { Adjustments } from './AdjustSheet.js';
import type { StockRow } from './Deposit.js';

const SCALED_FRACTION_ONE = 2n ** 60n;
const A_SECOND = 1_000;

function failureFromSigning(thrown: unknown): ReadableFailure {
  if (theWalletSaidNo(thrown)) {
    return failureOf('signatureRejected');
  }
  return thrown instanceof SubmissionRefused
    ? thrown.failure
    : failureOf('somethingWentWrong');
}

type BuiltAnswer = FailureAnswer & {
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
    quotedAtMilliseconds: number;
  };
};

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
  const { headersForABuild, networkName } = useSession();
  const [built, setBuilt] = useState<BuiltAnswer | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReadableFailure | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [rebuilds, setRebuilds] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    const beat = setInterval(() => {
      setNow(Date.now());
    }, A_SECOND);
    return () => {
      clearInterval(beat);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setBuilt(null);
    setSignature(null);
    setFailure(null);
    void (async () => {
      const answer = await fetch('/api/positions/build', {
        method: 'POST',
        headers: headersForABuild(),
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
      const body = await readTheAnswer<BuiltAnswer>(answer);
      setBuilt(body);
      setNow(Date.now());
      if (!answer.ok) {
        setFailure(readFailure(body) ?? failureOf('somethingWentWrong'));
      }
    })();
  }, [
    open,
    stock.mint,
    destinationSymbol,
    collateralAmountRaw,
    adjustments,
    rebuilds,
    headersForABuild,
  ]);

  const sign = useCallback(async (): Promise<void> => {
    if (built?.transaction === undefined) {
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      setSignature(
        await onSigned(
          built.transaction.map((one) => one.transaction),
          built.buildId ?? undefined,
        ),
      );
    } catch (thrown) {
      setFailure(failureFromSigning(thrown));
    } finally {
      setBusy(false);
    }
  }, [built, onSigned]);

  const summary = built?.summary;
  const quoteAge =
    summary === undefined ? 0 : quoteAgeSeconds(summary.quotedAtMilliseconds, now);
  const quoteIsStale =
    summary !== undefined &&
    signature === null &&
    theQuoteIsStale(summary.quotedAtMilliseconds, now);
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
          quoteAge: howLongAgo(quoteAge),
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
    <Sheet title={REVIEW_COPY.title} open={open} testId="review-sheet" onClose={onClose}>
      <Stack gap={14}>
        {built === null ? <SkeletonRows rows={5} testId="review-loading" /> : null}
        {failure === null ? null : (
          <Banner tone="caution" testId="review-failure">
            {failure.sentence}
          </Banner>
        )}
        {quoteIsStale ? (
          <Banner tone="caution" testId="stale-quote">
            <Stack gap={10}>
              <span>{FAILURE_COPY.staleQuote}</span>
              <div>
                <Button
                  tone="quiet"
                  testId="requote"
                  onClick={() => {
                    setRebuilds((count) => count + 1);
                  }}
                >
                  {REVIEW_COPY.readItAgain}
                </Button>
              </div>
            </Stack>
          </Banner>
        ) : null}

        {adjustments !== null && adjustments.targetLtvBps > stock.targetLtvBps ? (
          <p style={{ color: 'var(--color-text)', margin: 0 }}>
            {overrideLine(
              percent(adjustments.targetLtvBps, 0),
              percent(stock.targetLtvBps, 0),
            )}
          </p>
        ) : null}

        {summary === undefined ? null : (
          <Stack gap={6}>
            <Heading level={2} testId="review-depositing">
              {REVIEW_COPY.depositing(`$${money(collateralUsd)}`, summary.stockSymbol)}
            </Heading>
            <Mono tone="gold" style={{ fontSize: 20 }} testId="review-earns">
              {REVIEW_COPY.earns(
                `$${money(
                  (Number(BigInt(summary.borrowUsdcRaw)) / 1e6) *
                    ((summary.destinationTargetRateBps - summary.borrowRateBps) / 10_000),
                )}`,
                `${(
                  (summary.targetLtvBps *
                    (summary.destinationTargetRateBps - summary.borrowRateBps)) /
                  1_000_000
                ).toFixed(2)}%`,
              )}
            </Mono>
          </Stack>
        )}

        {signature === null ? (
          <Button
            testId="review-sign"
            disabled={
              built?.transaction === undefined ||
              busy ||
              quoteIsStale ||
              walletAddress === ''
            }
            onClick={() => void sign()}
          >
            {REVIEW_COPY.sign}
          </Button>
        ) : (
          <TransactionLink
            signature={signature}
            cluster={networkName}
            testId="open-signature"
          />
        )}

        <div>
          <button
            type="button"
            data-testid="review-details"
            onClick={() => {
              setDetailsOpen(!detailsOpen);
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
            {REVIEW_COPY.whatCanGoWrong}
          </button>
        </div>

        {!detailsOpen ? null : (
          <Stack gap={10}>
            {lines.map((line) => (
              <p
                key={line}
                style={{ margin: 0, color: 'var(--color-text)', fontSize: 14 }}
              >
                {line}
              </p>
            ))}
            <Mono tone="muted">{COMMON.oneSignature}</Mono>
          </Stack>
        )}

        {summary === undefined || !detailsOpen ? null : (
          <Stack gap={6}>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {QUOTE_COPY.quoted}
              </span>
              <Mono testId="review-quoted">
                {money(Number(BigInt(summary.quotedDestinationRaw)) / 1e9, 4)}{' '}
                {summary.destinationSymbol}
              </Mono>
            </Row>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {QUOTE_COPY.minimum}
              </span>
              <Mono tone="gold" testId="review-minimum">
                {money(Number(BigInt(summary.minimumDestinationRaw)) / 1e9, 4)}{' '}
                {summary.destinationSymbol}
              </Mono>
            </Row>
          </Stack>
        )}

        <Button tone="link" onClick={onClose}>
          {COMMON.close}
        </Button>
      </Stack>
    </Sheet>
  );
}
