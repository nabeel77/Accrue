'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import {
  Button,
  Heading,
  Mono,
  Muted,
  Panel,
  Row,
  Stack,
} from '../../components/ui/index.js';
import { COMMON } from '../../copy/common.js';
import { DEPOSIT_COPY } from '../../copy/deposit.js';
import { EXIT_LINE } from '../../copy/banners.js';
import { money, percent, rawToWhole, wholeToRaw } from '../../client/format.js';
import { useSession } from '../../client/session.js';
import { AcknowledgementSheet } from './AcknowledgementSheet.js';
import { AdjustSheet, type Adjustments } from './AdjustSheet.js';
import { ReviewSheet } from './ReviewSheet.js';

export interface StockRow {
  readonly symbol: string;
  readonly name: string;
  readonly mint: string;
  readonly maxLoanToValueBps: number;
  readonly liquidationThresholdBps: number;
  readonly targetLtvBps: number;
  readonly protectLtvBps: number;
  readonly growBelowLtvBps: number;
  readonly netYieldBps: number;
  readonly oraclePriceScaled: string;
  readonly decimals: number;
  readonly balanceRaw: string | null;
}

interface DestinationRow {
  readonly symbol: string;
  readonly name: string;
  readonly mint: string;
  readonly exitType: string;
  readonly targetRateBps: number;
  readonly targetRateSource: string;
  readonly yieldSource: string;
}

const SCALED_FRACTION_ONE = 2n ** 60n;

export function Deposit(): JSX.Element {
  const { me, signAndSubmit } = useSession();
  const [destinations, setDestinations] = useState<DestinationRow[]>([]);
  const [chosenDestination, setChosenDestination] = useState<string | null>(null);
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [borrowRateBps, setBorrowRateBps] = useState(0);
  const [chosenStock, setChosenStock] = useState<string | null>(null);
  const [dollars, setDollars] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [adjustments, setAdjustments] = useState<Adjustments | null>(null);
  const [acknowledgementOpen, setAcknowledgementOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const answer = await fetch('/api/destinations');
      const body = (await answer.json()) as { destinations: DestinationRow[] };
      setDestinations(body.destinations);
      setChosenDestination((current) => current ?? body.destinations[0]?.symbol ?? null);
    })();
  }, []);

  // The list refetches when the yield token changes, because the net yield depends on it.
  useEffect(() => {
    if (chosenDestination === null) {
      return;
    }
    void (async () => {
      const answer = await fetch(
        `/api/defaults?destination=${encodeURIComponent(chosenDestination)}`,
      );
      const body = (await answer.json()) as {
        stocks: StockRow[];
        borrowRateBps: number;
      };
      setStocks(body.stocks);
      setBorrowRateBps(body.borrowRateBps);
      setChosenStock((current) => current ?? body.stocks[0]?.symbol ?? null);
    })();
  }, [chosenDestination]);

  const stock = useMemo(
    () => stocks.find((entry) => entry.symbol === chosenStock) ?? null,
    [stocks, chosenStock],
  );
  const destination = useMemo(
    () => destinations.find((entry) => entry.symbol === chosenDestination) ?? null,
    [destinations, chosenDestination],
  );

  const price =
    stock === null
      ? 0
      : Number(BigInt(stock.oraclePriceScaled)) / Number(SCALED_FRACTION_ONE);
  const amountUsd = Number(dollars) || 0;
  const tokenEquivalent = price === 0 ? 0 : amountUsd / price;
  const targetLtvBps = adjustments?.targetLtvBps ?? stock?.targetLtvBps ?? 0;
  const protectLtvBps = adjustments?.protectLtvBps ?? stock?.protectLtvBps ?? 0;
  const borrowUsd = (amountUsd * targetLtvBps) / 10_000;
  const netBps =
    destination === null
      ? 0
      : Math.round((targetLtvBps * (destination.targetRateBps - borrowRateBps)) / 10_000);

  const balanceOf = useCallback(
    (entry: StockRow): number =>
      entry.balanceRaw === null ? 0 : rawToWhole(entry.balanceRaw, entry.decimals),
    [],
  );
  const holdsNoStock = stocks.every((entry) => balanceOf(entry) === 0);

  // The acknowledgement comes before the first position, not on the way in to the app.
  const openReview = useCallback((): void => {
    if (me?.acknowledgement?.accepted === false) {
      setAcknowledgementOpen(true);
      return;
    }
    setReviewOpen(true);
  }, [me]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns:
          'minmax(260px, 320px) minmax(320px, 1fr) minmax(260px, 320px)',
        gap: 20,
        alignItems: 'start',
      }}
      data-testid="deposit-screen"
      className="deposit-grid"
    >
      <Panel>
        <Stack gap={12}>
          <Heading level={3}>{DEPOSIT_COPY.stockColumnTitle}</Heading>
          {stocks.length === 0 ? <Muted>{COMMON.loading}</Muted> : null}
          {stocks.map((entry) => {
            const balance = balanceOf(entry);
            const chosen = entry.symbol === chosenStock;
            return (
              <button
                key={entry.mint}
                type="button"
                data-testid={`stock-${entry.symbol}`}
                onClick={() => {
                  setChosenStock(entry.symbol);
                  setAdjustments(null);
                }}
                style={{
                  textAlign: 'left',
                  background: chosen ? 'var(--color-raised)' : 'transparent',
                  border: '1px solid',
                  borderColor: chosen
                    ? 'var(--color-accent-deeper)'
                    : 'var(--color-hairline)',
                  borderRadius: 'var(--radius)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  opacity: balance > 0 ? 1 : 0.6,
                }}
              >
                <Row>
                  <Mono>{entry.symbol}</Mono>
                  <Mono tone="gold">{percent(entry.netYieldBps)}</Mono>
                </Row>
                <Mono tone="muted" style={{ fontSize: 12 }}>
                  {money(balance, 4)}
                </Mono>
              </button>
            );
          })}
          {holdsNoStock ? <Muted>{DEPOSIT_COPY.stockEmpty}</Muted> : null}
        </Stack>
      </Panel>

      <Panel>
        <Stack gap={14}>
          <Row>
            <Mono>{stock?.symbol ?? COMMON.missingValue}</Mono>
            <Mono tone="muted">
              {stock?.symbol ?? ''} → {destination?.name ?? ''}
            </Mono>
          </Row>

          <Row>
            <input
              data-testid="amount"
              inputMode="decimal"
              value={dollars}
              placeholder="0.00"
              onChange={(event) => {
                setDollars(event.target.value);
              }}
              style={{
                flex: 1,
                background: 'var(--color-raised-2)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius)',
                padding: '12px 14px',
                color: 'var(--color-text)',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 20,
              }}
            />
            <Button
              tone="quiet"
              testId="amount-max"
              onClick={() => {
                const balance = stock === null ? 0 : balanceOf(stock);
                setDollars((balance * price).toFixed(2));
              }}
            >
              {DEPOSIT_COPY.amountMax}
            </Button>
          </Row>
          <Mono tone="muted">
            {money(tokenEquivalent, 6)} {stock?.symbol ?? ''}
          </Mono>

          <Row>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {DEPOSIT_COPY.intoPrefix} {destination?.name ?? ''}
            </span>
            <Mono tone="gold">
              {destination === null
                ? COMMON.missingValue
                : `${percent(destination.targetRateBps)} ${DEPOSIT_COPY.targetSuffix}`}
            </Mono>
          </Row>

          <Stack gap={10}>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {DEPOSIT_COPY.earnsAbout}
              </span>
              <Mono tone="gold" style={{ fontSize: 18 }}>
                {percent(netBps)}
              </Mono>
            </Row>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {DEPOSIT_COPY.liquidatedIf} {stock?.symbol ?? ''} {DEPOSIT_COPY.falls}
              </span>
              <Mono>
                {stock === null
                  ? COMMON.missingValue
                  : percent(
                      Math.max(
                        10_000 -
                          Math.round(
                            (targetLtvBps / stock.liquidationThresholdBps) * 10_000,
                          ),
                        0,
                      ),
                      0,
                    )}
              </Mono>
            </Row>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {DEPOSIT_COPY.guardRepaysAt}
              </span>
              <Mono tone="accent">{percent(protectLtvBps, 0)}</Mono>
            </Row>
            <Muted>{DEPOSIT_COPY.guardNote}</Muted>
          </Stack>

          <Button
            testId="deposit"
            disabled={stock === null || destination === null || amountUsd <= 0}
            onClick={openReview}
          >
            {DEPOSIT_COPY.deposit}
          </Button>
          <Muted>{DEPOSIT_COPY.oneSignatureNote}</Muted>
          <Button
            tone="link"
            testId="adjust"
            onClick={() => {
              setAdjustOpen(true);
            }}
          >
            {DEPOSIT_COPY.adjust}
          </Button>
          <Muted>{DEPOSIT_COPY.referenceLine}</Muted>
        </Stack>
      </Panel>

      <Panel>
        <Stack gap={12}>
          <Heading level={3}>{DEPOSIT_COPY.earnInColumnTitle}</Heading>
          {destinations.map((entry) => {
            const chosen = entry.symbol === chosenDestination;
            return (
              <button
                key={entry.mint}
                type="button"
                data-testid={`destination-${entry.symbol}`}
                onClick={() => {
                  setChosenDestination(entry.symbol);
                }}
                style={{
                  textAlign: 'left',
                  background: chosen ? 'var(--color-raised)' : 'transparent',
                  border: '1px solid',
                  borderColor: chosen
                    ? 'var(--color-accent-deeper)'
                    : 'var(--color-hairline)',
                  borderRadius: 'var(--radius)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <Row>
                  <Mono>{entry.symbol}</Mono>
                  <Mono tone="gold">
                    {percent(entry.targetRateBps)} {DEPOSIT_COPY.targetSuffix}
                  </Mono>
                </Row>
                <Mono tone="muted" style={{ fontSize: 12 }}>
                  {EXIT_LINE.unknown}
                </Mono>
              </button>
            );
          })}
        </Stack>
      </Panel>

      {stock === null ? null : (
        <AdjustSheet
          open={adjustOpen}
          stock={stock}
          borrowRateBps={borrowRateBps}
          destinationName={destination?.name ?? ''}
          yieldSource={destination?.yieldSource ?? ''}
          adjustments={adjustments}
          onChange={setAdjustments}
          onClose={() => {
            setAdjustOpen(false);
          }}
        />
      )}

      {stock === null || destination === null ? null : (
        <ReviewSheet
          open={reviewOpen}
          stock={stock}
          destinationSymbol={destination.symbol}
          collateralAmountRaw={wholeToRaw(tokenEquivalent, stock.decimals)}
          adjustments={adjustments}
          onClose={() => {
            setReviewOpen(false);
          }}
          onSigned={async (transactions, buildId) => signAndSubmit(transactions, buildId)}
          walletAddress={me?.wallet ?? ''}
          borrowUsd={borrowUsd}
          rawToWhole={rawToWhole}
        />
      )}

      <AcknowledgementSheet
        open={acknowledgementOpen}
        onAccepted={() => {
          setAcknowledgementOpen(false);
          setReviewOpen(true);
        }}
      />
    </div>
  );
}
