'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import {
  Banner,
  Button,
  CENTRED_SCREEN,
  Explainer,
  Heading,
  Mono,
  Muted,
  NumbersInMono,
  Panel,
  Row,
  SkeletonCard,
  Stack,
} from '../../components/ui/index.js';
import { COMMON } from '../../copy/common.js';
import { DEPOSIT_COPY, EARNS_EXPLAINER_COPY } from '../../copy/deposit.js';
import { earnsPerYearLines } from '../../client/earnsPerYearLines.js';
import { YIELD_LINE } from '../../copy/banners.js';
import { FAILURE_COPY, FAILURE_DETAILS } from '../../copy/errors.js';
import {
  howLongAgo,
  money,
  percent,
  rawToWhole,
  wholeToRaw,
} from '../../client/format.js';
import type { DepositSizing } from '@accrue/core/deposit';
import {
  aPriceHasArrivedFor,
  walletValueInDollars,
  whatTheMaxButtonFills,
  wholeBalanceOfAStock,
} from '@accrue/core/max-deposit';

import { useSession } from '../../client/session.js';
import { AcknowledgementSheet } from './AcknowledgementSheet.js';
import { AdjustSheet, type Adjustments } from './AdjustSheet.js';
import { DepositDetailsSheet } from './DepositDetailsSheet.js';
import { ReviewSheet } from './ReviewSheet.js';
import { TopUpSheet } from './TopUpSheet.js';
import { YieldTokenDetailsSheet, type PriceSource } from './YieldTokenDetailsSheet.js';

export interface CatalogueRow {
  readonly symbol: string;
  readonly name: string;
}

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
  readonly openPositionId: string | null;
  readonly openPosition: {
    readonly id: string;
    readonly targetLtvBps: number;
    readonly protectLtvBps: number;
    readonly growEnabled: boolean;
  } | null;
}

interface DestinationRow {
  readonly symbol: string;
  readonly name: string;
  readonly mint: string;
  readonly exitType: string;
  readonly targetRateBps: number;
  readonly targetRateSource: string;
  readonly targetRateReadAtMilliseconds: number | null;
  readonly yieldSource: string;
  // Null when no quote came back, and then the destination is not offered.
  readonly exit: {
    readonly sellableTodayUsdcRaw: string;
    readonly slippageBps: number;
    readonly quotedAtMilliseconds: number;
    readonly destinationPerUsdc: number;
  } | null;
}

const SCALED_FRACTION_ONE = 2n ** 60n;
const STOCK_ROW_EXPLAINER_WIDTH = 30;
const HOW_OFTEN_THE_SCREEN_READS_AGAIN = 6_000;
const STOCK_LIST_HEIGHT = 'min(56vh, 460px)';
const A_PAUSE_IN_TYPING = 400;

interface PositionSizeLimits {
  readonly smallestUsd: number;
  readonly largestUsd: number;
}

function wholeBalanceOf(entry: StockRow): number {
  return wholeBalanceOfAStock(entry);
}

export function Deposit(): JSX.Element {
  const { me, signAndSubmit, tokensGrantedCount } = useSession();
  const [destinations, setDestinations] = useState<DestinationRow[]>([]);
  const [priceSource, setPriceSource] = useState<PriceSource>('jupiter');
  const [chosenDestination, setChosenDestination] = useState<string | null>(null);
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueRow[]>([]);
  const [borrowRateBps, setBorrowRateBps] = useState(0);
  const [limits, setLimits] = useState<PositionSizeLimits | null>(null);
  const [stalePrice, setStalePrice] = useState<{ ageSeconds: number } | null>(null);
  const [chosenStock, setChosenStock] = useState<string | null>(null);
  const [dollars, setDollars] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [adjustments, setAdjustments] = useState<Adjustments | null>(null);
  const [acknowledgementOpen, setAcknowledgementOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exitShownFor, setExitShownFor] = useState<string | null>(null);
  const [sizing, setSizing] = useState<DepositSizing | null>(null);
  const [quotedAt, setQuotedAt] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const answer = await fetch('/api/destinations', { cache: 'no-store' });
      const body = (await answer.json()) as {
        destinations: DestinationRow[];
        priceSource: PriceSource;
      };
      setDestinations(body.destinations);
      setPriceSource(body.priceSource);
      const offered = body.destinations.find((entry) => entry.exit !== null);
      setChosenDestination((current) => current ?? offered?.symbol ?? null);
    })();
  }, [tokensGrantedCount]);

  const readTheDefaults = useCallback(async (): Promise<void> => {
    if (chosenDestination === null) {
      return;
    }
    const asked = new URLSearchParams({ destination: chosenDestination });
    if (chosenStock !== null) {
      asked.set('stock', chosenStock);
    }
    if (Number(dollars) > 0) {
      asked.set('dollars', dollars);
    }
    const answer = await fetch(`/api/defaults?${asked.toString()}`, {
      cache: 'no-store',
    });
    const body = (await answer.json()) as {
      stocks: StockRow[];
      catalogue: CatalogueRow[];
      borrowRateBps: number;
      smallestPositionUsd: number;
      largestPositionUsd: number;
      oraclePriceAgeSeconds: number;
      oraclePriceIsTooOld: boolean;
      sizing: DepositSizing | null;
      quotedAtMilliseconds: number | null;
    };
    setStocks(body.stocks);
    setCatalogue(body.catalogue);
    setBorrowRateBps(body.borrowRateBps);
    setLimits({
      smallestUsd: body.smallestPositionUsd,
      largestUsd: body.largestPositionUsd,
    });
    setStalePrice(
      body.oraclePriceIsTooOld ? { ageSeconds: body.oraclePriceAgeSeconds } : null,
    );
    setChosenStock((current) => current ?? body.stocks[0]?.symbol ?? null);
    setSizing(body.sizing);
    setQuotedAt(body.quotedAtMilliseconds);
  }, [chosenDestination, chosenStock, dollars, tokensGrantedCount]);

  useEffect(() => {
    const soon = setTimeout(() => {
      void readTheDefaults();
    }, A_PAUSE_IN_TYPING);
    const again = setInterval(() => {
      void readTheDefaults();
    }, HOW_OFTEN_THE_SCREEN_READS_AGAIN);
    return () => {
      clearTimeout(soon);
      clearInterval(again);
    };
  }, [readTheDefaults]);

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

  const walletValueUsd = walletValueInDollars(stock);
  const aPriceHasArrived = aPriceHasArrivedFor(stock);
  const holdsNoStock = stocks.every((entry) => wholeBalanceOf(entry) === 0);

  const openReview = useCallback((): void => {
    if (me?.acknowledgement?.accepted === false) {
      setAcknowledgementOpen(true);
      return;
    }
    if (stock?.openPositionId != null) {
      setTopUpOpen(true);
      return;
    }
    setReviewOpen(true);
  }, [me, stock]);

  return (
    <Stack gap={16} testId="deposit-screen" style={CENTRED_SCREEN}>
      {stalePrice === null ? null : (
        <Banner tone="caution" testId="stale-price">
          {`${FAILURE_COPY.priceTooOld} ${FAILURE_DETAILS.priceAge(
            stock?.symbol ?? DEPOSIT_COPY.stockColumnTitle,
            howLongAgo(stalePrice.ageSeconds),
          )}`}
        </Banner>
      )}
      <div
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns:
            'minmax(260px, 320px) minmax(320px, 1fr) minmax(260px, 320px)',
          gap: 20,
          alignItems: 'start',
        }}
        className="deposit-grid"
      >
        <Panel>
          <Stack gap={12}>
            <Row style={{ paddingRight: STOCK_ROW_EXPLAINER_WIDTH }}>
              <Heading level={3}>{DEPOSIT_COPY.stockColumnTitle}</Heading>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                {DEPOSIT_COPY.earnsColumnTitle}
              </span>
            </Row>
            <Stack
              gap={12}
              testId="stock-list"
              className="acr-scroll"
              style={{
                maxHeight: STOCK_LIST_HEIGHT,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {stocks.length === 0 ? (
                <Stack gap={10} testId="stocks-loading">
                  <SkeletonCard lines={1} />
                  <SkeletonCard lines={1} />
                  <SkeletonCard lines={1} />
                </Stack>
              ) : null}
              {stocks.map((entry) => {
                const balance = wholeBalanceOf(entry);
                const chosen = entry.symbol === chosenStock;
                return (
                  <Row
                    key={entry.mint}
                    gap={10}
                    style={{
                      alignItems: 'flex-start',
                      border: '1px solid',
                      borderRadius: 12,
                      padding: '12px 14px',
                      minHeight: 60,
                      position: 'relative',
                      background: chosen
                        ? 'linear-gradient(90deg, rgba(55,185,141,.24), rgba(111,216,176,.08) 55%, rgba(226,184,113,.12))'
                        : 'transparent',
                      borderColor: 'transparent',
                      transition: 'background .25s',
                      opacity: balance > 0 ? 1 : 0.6,
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: -2,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        opacity: chosen ? 1 : 0,
                        transition: 'opacity .25s',
                      }}
                    >
                      <path
                        d="M1 12 H5 V7 H9 V2 H13"
                        fill="none"
                        stroke="#37B98D"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <button
                      type="button"
                      data-testid={`stock-${entry.symbol}`}
                      data-mint={entry.mint}
                      onClick={() => {
                        setChosenStock(entry.symbol);
                        setAdjustments(null);
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    >
                      <Row>
                        <Mono>{entry.symbol}</Mono>
                        <Mono tone="gold">{percent(entry.netYieldBps)}</Mono>
                      </Row>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        <NumbersInMono
                          sentence={DEPOSIT_COPY.balanceInYourWallet(money(balance))}
                        />
                      </span>
                    </button>
                    {destination === null ? null : (
                      <Explainer
                        title={EARNS_EXPLAINER_COPY.title}
                        testId={`stock-earns-explainer-${entry.symbol}`}
                        lines={earnsPerYearLines({
                          stockSymbol: entry.symbol,
                          destinationSymbol: destination.symbol,
                          targetLtvBps: entry.targetLtvBps,
                          destinationRateBps: destination.targetRateBps,
                          borrowRateBps,
                          netYieldBps: entry.netYieldBps,
                        })}
                      />
                    )}
                  </Row>
                );
              })}
              {catalogue.map((entry) => (
                <Row
                  key={entry.symbol}
                  data-testid={`stock-unavailable-${entry.symbol}`}
                  style={{
                    alignItems: 'center',
                    border: '1px solid transparent',
                    borderRadius: 12,
                    padding: '12px 14px',
                    minHeight: 60,
                    opacity: 0.45,
                  }}
                >
                  <Mono>{entry.symbol}</Mono>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                    {DEPOSIT_COPY.notOnThisNetwork}
                  </span>
                </Row>
              ))}
            </Stack>
            {holdsNoStock ? <Muted>{DEPOSIT_COPY.stockEmpty}</Muted> : null}
          </Stack>
        </Panel>

        <Panel>
          <Stack gap={14}>
            <Row>
              <Mono tone="muted" style={{ fontSize: 20 }}>
                {DEPOSIT_COPY.amountPrefix}
              </Mono>
              <input
                data-testid="amount"
                inputMode="decimal"
                value={dollars}
                placeholder="0.00"
                aria-label={DEPOSIT_COPY.amountLabel}
                onChange={(event) => {
                  setDollars(event.target.value);
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
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
              {stock === null ? null : (
                <Mono
                  tone="secondary"
                  testId="amount-badge"
                  style={{
                    border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--color-raised)',
                    padding: '6px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stock.symbol}
                </Mono>
              )}
              <Button
                tone="quiet"
                testId="amount-max"
                disabled={!aPriceHasArrived}
                onClick={() => {
                  setDollars(whatTheMaxButtonFills(stock, limits?.largestUsd ?? null));
                }}
              >
                {aPriceHasArrived
                  ? DEPOSIT_COPY.amountMax
                  : DEPOSIT_COPY.amountMaxWaitingForAPrice}
              </Button>
            </Row>
            {stock === null ? null : (
              <Mono tone="muted" testId="amount-under" style={{ fontSize: 12 }}>
                {aPriceHasArrived
                  ? DEPOSIT_COPY.inYourWalletWorth(
                      money(wholeBalanceOf(stock), 3),
                      stock.symbol,
                      `$${money(walletValueUsd, 0)}`,
                    )
                  : DEPOSIT_COPY.inYourWallet(
                      money(wholeBalanceOf(stock), 3),
                      stock.symbol,
                    )}
              </Mono>
            )}

            {sizing === null || stock === null ? null : (
              <Heading level={2} testId="earns-about">
                {stock.openPositionId == null
                  ? DEPOSIT_COPY.earnsLine(
                      `$${money(sizing.earningsUsdAYear)}`,
                      percent(sizing.netYieldBps),
                    )
                  : DEPOSIT_COPY.addsLine(
                      `$${money(sizing.earningsUsdAYear)}`,
                      stock.symbol,
                      percent(sizing.netYieldBps),
                    )}
              </Heading>
            )}

            {sizing?.destinationAmount == null || destination === null ? null : (
              <span
                data-testid="receives-about"
                style={{ color: 'var(--color-text-muted)', fontSize: 12 }}
              >
                <NumbersInMono
                  sentence={DEPOSIT_COPY.receivesLine(
                    money(sizing.destinationAmount, 4),
                    destination.symbol,
                  )}
                />
              </span>
            )}

            <Button
              testId="deposit"
              disabled={stock === null || destination === null || amountUsd <= 0}
              onClick={openReview}
            >
              {DEPOSIT_COPY.deposit}
            </Button>

            <div>
              <button
                type="button"
                data-testid="deposit-details"
                disabled={sizing === null}
                onClick={() => {
                  setDetailsOpen(true);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  textDecoration: 'underline',
                  cursor: sizing === null ? 'default' : 'pointer',
                  padding: 0,
                }}
              >
                {DEPOSIT_COPY.details}
              </button>
            </div>
          </Stack>
        </Panel>

        <Panel>
          <Stack gap={12}>
            <Heading level={3}>{DEPOSIT_COPY.earnInColumnTitle}</Heading>
            {destinations.length === 0 ? (
              <Stack gap={10} testId="destinations-loading">
                <SkeletonCard lines={1} />
                <SkeletonCard lines={1} />
              </Stack>
            ) : null}
            {destinations.map((entry) => {
              const chosen = entry.symbol === chosenDestination;
              const offered = entry.exit !== null;
              const showing = exitShownFor === entry.symbol;
              return (
                <div
                  key={entry.mint}
                  style={{
                    border: '1px solid',
                    borderColor: chosen
                      ? 'var(--color-accent-deeper)'
                      : 'var(--color-hairline)',
                    background: chosen ? 'var(--color-raised)' : 'transparent',
                    borderRadius: 'var(--radius)',
                    padding: '10px 12px',
                    opacity: offered ? 1 : 0.6,
                  }}
                >
                  <button
                    type="button"
                    data-testid={`destination-${entry.symbol}`}
                    disabled={!offered}
                    onClick={() => {
                      setChosenDestination(entry.symbol);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: offered ? 'pointer' : 'default',
                    }}
                  >
                    <Row>
                      <Mono>{entry.symbol}</Mono>
                      <Mono tone="gold">
                        {YIELD_LINE.aYear(percent(entry.targetRateBps))}
                      </Mono>
                    </Row>
                    <Row style={{ marginTop: 4 }}>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {DEPOSIT_COPY.exchangeRate}
                      </span>
                      <Mono tone="secondary" style={{ fontSize: 12 }}>
                        {entry.exit === null
                          ? COMMON.missingValue
                          : DEPOSIT_COPY.oneIsWorth(
                              entry.symbol,
                              money(1 / entry.exit.destinationPerUsdc, 4),
                            )}
                      </Mono>
                    </Row>
                  </button>
                  <button
                    type="button"
                    data-testid={`destination-details-${entry.symbol}`}
                    onClick={() => {
                      setExitShownFor(showing ? null : entry.symbol);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      padding: 0,
                      marginTop: 8,
                      fontSize: 12,
                    }}
                  >
                    {DEPOSIT_COPY.details}
                  </button>
                  <YieldTokenDetailsSheet
                    open={showing}
                    destinationSymbol={entry.symbol}
                    targetRateBps={entry.targetRateBps}
                    targetRateSource={entry.targetRateSource}
                    targetRateReadAtMilliseconds={entry.targetRateReadAtMilliseconds}
                    exit={entry.exit}
                    priceSource={priceSource}
                    onClose={() => {
                      setExitShownFor(null);
                    }}
                  />
                </div>
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
            destinationSymbol={destination?.symbol ?? ''}
            tokens={tokenEquivalent}
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
            onSigned={async (transactions, buildId) =>
              signAndSubmit(transactions, buildId)
            }
            walletAddress={me?.wallet ?? ''}
            borrowUsd={borrowUsd}
            rawToWhole={rawToWhole}
          />
        )}

        {stock?.openPositionId == null ? null : (
          <TopUpSheet
            open={topUpOpen}
            positionId={stock.openPositionId}
            collateralAmountRaw={wholeToRaw(tokenEquivalent, stock.decimals)}
            onClose={() => {
              setTopUpOpen(false);
            }}
            onDone={() => {
              void readTheDefaults();
            }}
          />
        )}

        {sizing === null || stock === null || destination === null ? null : (
          <DepositDetailsSheet
            open={detailsOpen}
            stockSymbol={stock.symbol}
            destinationSymbol={destination.symbol}
            sizing={sizing}
            quotedAtMilliseconds={quotedAt}
            targetLtvBps={targetLtvBps}
            protectLtvBps={protectLtvBps}
            liquidationThresholdBps={stock.liquidationThresholdBps}
            limits={limits}
            openPosition={
              stock.openPosition === null
                ? null
                : {
                    href: `/app/positions/${stock.openPosition.id}`,
                    targetLtvBps: stock.openPosition.targetLtvBps,
                    protectLtvBps: stock.openPosition.protectLtvBps,
                    growEnabled: stock.openPosition.growEnabled,
                  }
            }
            onAdjust={() => {
              setDetailsOpen(false);
              setAdjustOpen(true);
            }}
            onClose={() => {
              setDetailsOpen(false);
            }}
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
    </Stack>
  );
}
