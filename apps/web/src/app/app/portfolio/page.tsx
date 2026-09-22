'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import {
  Button,
  CENTRED_SCREEN,
  Eyebrow,
  Heading,
  HealthBar,
  Mono,
  Muted,
  Panel,
  Row,
  Sheet,
  Skeleton,
  SkeletonCard,
  Sparkline,
  Stack,
  type SparklinePoint,
} from '../../../components/ui/index.js';
import { COMMON } from '../../../copy/common.js';
import { PORTFOLIO_COPY, PORTFOLIO_VALUE_COPY } from '../../../copy/portfolio.js';
import { howLongAgo, money, percent } from '../../../client/format.js';
import { usePollWhenVisible } from '../../../client/pollWhenVisible.js';
import { useSession } from '../../../client/session.js';

const A_SECOND = 1_000;
const HOW_OFTEN_THE_VALUE_IS_READ = 10 * A_SECOND;
const POSITION_COLUMNS = '150px 1fr minmax(0, 420px) 14px';

function edgeFor(zone: string | undefined): string {
  if (zone === 'caution') {
    return '#E8B03A';
  }
  if (zone === 'danger') {
    return '#E2685C';
  }
  return 'var(--color-hairline)';
}

function rawToWhole(raw: string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

interface PortfolioValue {
  readonly breakdown: {
    readonly stockInTheMarketUsd: number;
    readonly yieldTokensUsd: number;
    readonly owedUsd: number;
    readonly positionEquityUsd: number;
    readonly stockInYourWalletUsd: number;
    readonly usdcInYourWalletUsd: number;
    readonly everythingYouHoldUsd: number;
  };
  readonly earned: {
    readonly earnedUsd: number;
    readonly earnedBps: number;
    readonly direction: 'up' | 'down' | 'flat';
  };
  readonly walletStocks: readonly {
    readonly symbol: string;
    readonly amount: number;
    readonly valueUsd: number;
  }[];
  readonly holdings: readonly {
    readonly symbol: string;
    readonly amount: number;
    readonly priceUsd: number;
    readonly valueUsd: number;
  }[];
  readonly changeUsd: number;
  readonly changeBps: number;
  readonly direction: 'up' | 'down' | 'flat';
  readonly line: readonly SparklinePoint[];
  readonly sinceMilliseconds: number | null;
}

interface PortfolioEntry {
  readonly id: string;
  readonly positionAddress: string | null;
  readonly status: string;
  readonly onChain: {
    readonly state: string;
    readonly stockSymbol: string;
    readonly destinationSymbol: string;
    readonly destinationDecimals: number;
    readonly destinationRaw: string;
    readonly collateralValueScaled: string;
    readonly loanToValueBps: number;
    readonly targetLtvBps: number;
    readonly netYieldBps: number;
    readonly liquidationThresholdBps: number;
    readonly oraclePriceScaled: string;
    readonly healthZone: 'healthy' | 'caution' | 'danger';
    readonly fillBps: number;
    readonly debtRaw: string;
    readonly protectLtvBps: number;
    readonly collateralRaw: string;
    readonly collateralDecimals: number;
    readonly fallToLiquidationBps: number;
    readonly earnedUsd: number;
  } | null;
}

const SCALED_FRACTION_ONE = 2n ** 60n;

function inDollars(scaled: string): number {
  return Number(BigInt(scaled)) / Number(SCALED_FRACTION_ONE);
}

function Figure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Row>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <Mono>{value}</Mono>
    </Row>
  );
}

export default function PortfolioPage(): JSX.Element {
  const [positions, setPositions] = useState<PortfolioEntry[] | null>(null);
  const [value, setValue] = useState<PortfolioValue | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const { tokensGrantedCount } = useSession();

  const readTheValue = useCallback(async (): Promise<void> => {
    const answer = await fetch('/api/portfolio', { cache: 'no-store' });
    if (answer.ok) {
      setValue((await answer.json()) as PortfolioValue);
    }
  }, []);

  useEffect(() => {
    setValue(null);
    void readTheValue();
  }, [readTheValue, tokensGrantedCount]);

  usePollWhenVisible(readTheValue, HOW_OFTEN_THE_VALUE_IS_READ);

  useEffect(() => {
    setPositions(null);
    void (async () => {
      const answer = await fetch('/api/positions', { cache: 'no-store' });
      if (!answer.ok) {
        setPositions([]);
        return;
      }
      const body = (await answer.json()) as { positions: PortfolioEntry[] };
      setPositions(body.positions);
    })();
  }, [tokensGrantedCount]);

  return (
    <Stack
      gap={20}
      style={{ ...CENTRED_SCREEN, maxWidth: 900 }}
      testId="portfolio-screen"
    >
      <Heading level={1}>{PORTFOLIO_COPY.title}</Heading>

      <Panel>
        <Stack gap={16}>
          {value === null ? (
            <Stack gap={10} style={{ alignItems: 'center', width: '100%' }}>
              <Skeleton width={220} height={44} />
              <Skeleton width={160} height={14} />
              <Skeleton width="100%" height={96} />
            </Stack>
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 24,
                  width: '100%',
                  alignItems: 'start',
                  textAlign: 'left',
                }}
              >
                <Stack gap={6}>
                  <Eyebrow>{PORTFOLIO_VALUE_COPY.inAccrue}</Eyebrow>
                  <Mono
                    testId="portfolio-total"
                    style={{ fontSize: 32, letterSpacing: '-0.02em' }}
                  >
                    {`$${money(value.breakdown.positionEquityUsd)}`}
                  </Mono>
                </Stack>

                <Stack gap={6}>
                  <Eyebrow>{PORTFOLIO_VALUE_COPY.owedToTheMarket}</Eyebrow>
                  <Mono
                    testId="portfolio-owed"
                    style={{ fontSize: 32, letterSpacing: '-0.02em' }}
                  >
                    {`$${money(value.breakdown.owedUsd)}`}
                  </Mono>
                </Stack>

                <Stack
                  gap={6}
                  style={{
                    margin: '-10px -12px',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background:
                      'linear-gradient(90deg, rgba(55,185,141,0), rgba(55,185,141,.10) 50%, rgba(226,184,113,.16))',
                    boxShadow: '0 1px 0 rgba(111,216,176,.25) inset',
                  }}
                >
                  <Eyebrow style={{ color: 'var(--color-text-secondary)' }}>
                    {PORTFOLIO_VALUE_COPY.earnedSoFar}
                  </Eyebrow>
                  <Mono
                    testId="portfolio-earned"
                    tone={value.earned.direction === 'down' ? 'caution' : 'accent'}
                    style={{ fontSize: 32, letterSpacing: '-0.02em' }}
                  >
                    {`${value.earned.earnedUsd < 0 ? '−' : '+'}$${money(Math.abs(value.earned.earnedUsd))}`}
                  </Mono>
                  <Row style={{ gap: 8, flexWrap: 'wrap' }}>
                    <Mono
                      testId="portfolio-earned-percent"
                      tone={value.earned.direction === 'down' ? 'caution' : 'accent'}
                    >
                      {`${value.earned.earnedBps < 0 ? '−' : '+'}${percent(Math.abs(value.earned.earnedBps))}`}
                    </Mono>
                    <Muted>{PORTFOLIO_VALUE_COPY.afterTheLoan}</Muted>
                  </Row>
                </Stack>
              </div>

              {value.holdings.length === 0 ? (
                <Muted testId="nothing-earning">
                  {PORTFOLIO_VALUE_COPY.nothingEarningYet}
                </Muted>
              ) : (
                <Stack gap={8} style={{ width: '100%' }}>
                  <Muted>{PORTFOLIO_VALUE_COPY.holdingTitle}</Muted>
                  {value.holdings.map((holding) => (
                    <Row key={holding.symbol} data-testid={`holding-${holding.symbol}`}>
                      <Mono>
                        {PORTFOLIO_VALUE_COPY.holdingLine(
                          money(holding.amount),
                          holding.symbol,
                        )}
                      </Mono>
                      <Row style={{ gap: 10 }}>
                        <Muted>
                          {PORTFOLIO_VALUE_COPY.holdingPrice(
                            `$${holding.priceUsd.toFixed(4)}`,
                          )}
                        </Muted>
                        <Mono>{`$${money(holding.valueUsd)}`}</Mono>
                      </Row>
                    </Row>
                  ))}
                </Stack>
              )}

              {value.line.length < 2 ? (
                <Muted testId="portfolio-no-line">
                  {PORTFOLIO_VALUE_COPY.nothingYet}
                </Muted>
              ) : (
                <Stack gap={6} style={{ width: '100%' }}>
                  <Sparkline
                    points={value.line}
                    direction={value.direction}
                    label={PORTFOLIO_VALUE_COPY.inYourPositions}
                    testId="portfolio-line"
                  />
                  {value.sinceMilliseconds === null ? null : (
                    <Muted>
                      {PORTFOLIO_VALUE_COPY.since(
                        howLongAgo((Date.now() - value.sinceMilliseconds) / A_SECOND),
                      )}
                    </Muted>
                  )}
                </Stack>
              )}

              <Button
                tone="quiet"
                testId="see-breakdown"
                onClick={() => {
                  setBreakdownOpen(true);
                }}
              >
                {PORTFOLIO_VALUE_COPY.seeBreakdown}
              </Button>
            </>
          )}
        </Stack>
      </Panel>

      <Stack gap={14}>
        <Heading level={2}>{PORTFOLIO_COPY.openPositions}</Heading>
        {positions === null ? (
          <Stack gap={8} testId="positions-loading">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </Stack>
        ) : null}
        {positions?.length === 0 ? (
          <Muted testId="no-positions">{PORTFOLIO_COPY.noPositions}</Muted>
        ) : null}
        {positions?.map((entry) => {
          const chain = entry.onChain;
          const closed = chain?.state !== 'Open';
          const price = chain === null ? 0 : inDollars(chain.oraclePriceScaled);
          const liquidatedAt =
            chain === null || chain.liquidationThresholdBps === 0
              ? 0
              : (price * chain.loanToValueBps) / chain.liquidationThresholdBps;
          return (
            <Link
              key={entry.id}
              href={`/app/positions/${entry.id}`}
              data-testid={`position-${entry.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: POSITION_COLUMNS,
                gap: '14px 24px',
                alignItems: 'center',
                background: '#121110',
                border: '1px solid var(--color-hairline)',
                borderLeft: `3px solid ${edgeFor(chain?.healthZone)}`,
                borderRadius: 12,
                padding: '16px 18px',
                color: closed ? 'var(--color-text-muted)' : 'var(--color-text)',
                textDecoration: 'none',
                minWidth: 0,
              }}
            >
              <Stack gap={4} style={{ minWidth: 0 }}>
                <Mono style={{ fontSize: 16, fontWeight: 500 }}>
                  {chain === null
                    ? (entry.positionAddress ?? COMMON.missingValue)
                    : chain.stockSymbol}
                </Mono>
                <Mono tone="secondary" style={{ fontSize: 13 }}>
                  {chain === null
                    ? entry.status
                    : money(rawToWhole(chain.collateralRaw, chain.collateralDecimals), 4)}
                </Mono>
              </Stack>

              <Row style={{ gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
                {chain === null || closed ? (
                  <Mono tone="muted" style={{ fontSize: 13 }}>
                    {PORTFOLIO_COPY.noLongerOpen}
                  </Mono>
                ) : (
                  <>
                    <HealthBar
                      fillBps={chain.fillBps}
                      zone={chain.healthZone}
                      label={PORTFOLIO_COPY.health}
                    />
                    <Row style={{ gap: 6, flex: 'none' }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: 'var(--color-accent)',
                        }}
                      />
                      <span
                        style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}
                      >
                        {PORTFOLIO_COPY.guarded}
                      </span>
                    </Row>
                  </>
                )}
              </Row>

              {chain === null ? (
                <span />
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.4fr 1fr 0.8fr',
                    gap: '8px 20px',
                    minWidth: 0,
                  }}
                >
                  <Stack gap={3}>
                    <Eyebrow style={{ fontSize: 10 }}>
                      {PORTFOLIO_COPY.liquidatedAt}
                    </Eyebrow>
                    <Mono style={{ fontSize: 13 }}>
                      {PORTFOLIO_COPY.priceAndDistance(
                        `$${money(liquidatedAt)}`,
                        percent(chain.fallToLiquidationBps, 0),
                      )}
                    </Mono>
                  </Stack>
                  <Stack gap={3}>
                    <Eyebrow style={{ fontSize: 10 }}>{PORTFOLIO_COPY.earned}</Eyebrow>
                    <Mono
                      tone={closed ? 'muted' : 'gold'}
                      style={{ fontSize: 13 }}
                    >{`${chain.earnedUsd < 0 ? '−' : '+'}$${money(Math.abs(chain.earnedUsd))}`}</Mono>
                  </Stack>
                  <Stack gap={3}>
                    <Eyebrow style={{ fontSize: 10 }}>{PORTFOLIO_COPY.inWhat}</Eyebrow>
                    <Mono style={{ fontSize: 13 }}>{chain.destinationSymbol}</Mono>
                  </Stack>
                </div>
              )}

              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M5 3l4 4-4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
            </Link>
          );
        })}
      </Stack>

      {value === null || value.walletStocks.length === 0 ? null : (
        <Stack gap={14}>
          <Heading level={2}>{PORTFOLIO_COPY.stocksInWallet}</Heading>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))',
              gap: 8,
            }}
          >
            {value.walletStocks.map((held) => (
              <div
                key={held.symbol}
                className="acr-card-quiet"
                data-testid={`wallet-${held.symbol}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 18px',
                  gap: 12,
                }}
              >
                <Stack gap={4}>
                  <Mono style={{ fontSize: 16, fontWeight: 500 }}>{held.symbol}</Mono>
                  <Mono tone="secondary" style={{ fontSize: 13 }}>
                    {PORTFOLIO_COPY.balanceAndValue(
                      money(held.amount),
                      `$${money(held.valueUsd)}`,
                    )}
                  </Mono>
                </Stack>
                <Link
                  href={`/app?stock=${held.symbol}`}
                  data-testid={`put-to-work-${held.symbol}`}
                  style={{
                    flex: 'none',
                    height: 36,
                    padding: '0 12px',
                    border: '1px solid rgba(111,216,176,.45)',
                    color: '#6FD8B0',
                    background: 'rgba(55,185,141,.12)',
                    borderRadius: 999,
                    boxShadow: '0 6px 20px rgba(55,185,141,.15)',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {PORTFOLIO_COPY.putToWork}
                </Link>
              </div>
            ))}
          </div>
        </Stack>
      )}

      {value === null ? null : (
        <Sheet
          title={PORTFOLIO_VALUE_COPY.breakdownTitle}
          open={breakdownOpen}
          testId="portfolio-breakdown"
          onClose={() => {
            setBreakdownOpen(false);
          }}
        >
          <Stack gap={10}>
            <Figure
              label={PORTFOLIO_VALUE_COPY.stockInTheMarket}
              value={`$${money(value.breakdown.stockInTheMarketUsd)}`}
            />
            <Figure
              label={PORTFOLIO_VALUE_COPY.yieldTokens}
              value={`$${money(value.breakdown.yieldTokensUsd)}`}
            />
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {PORTFOLIO_VALUE_COPY.owed}
              </span>
              <Mono tone="gold">{`−$${money(value.breakdown.owedUsd)}`}</Mono>
            </Row>
            <Figure
              label={PORTFOLIO_VALUE_COPY.positionEquity}
              value={`$${money(value.breakdown.positionEquityUsd)}`}
            />
            <Figure
              label={PORTFOLIO_VALUE_COPY.stockInYourWallet}
              value={`$${money(value.breakdown.stockInYourWalletUsd)}`}
            />
            <Figure
              label={PORTFOLIO_VALUE_COPY.usdcInYourWallet}
              value={`$${money(value.breakdown.usdcInYourWalletUsd)}`}
            />
            <Figure
              label={PORTFOLIO_VALUE_COPY.everything}
              value={`$${money(value.breakdown.everythingYouHoldUsd)}`}
            />
            <Button
              tone="link"
              onClick={() => {
                setBreakdownOpen(false);
              }}
            >
              {COMMON.close}
            </Button>
          </Stack>
        </Sheet>
      )}
    </Stack>
  );
}
