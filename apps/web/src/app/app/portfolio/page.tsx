'use client';

import Link from 'next/link';
import { useEffect, useState, type JSX } from 'react';

import {
  Button,
  CENTRED_SCREEN,
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

const A_SECOND = 1_000;

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

  useEffect(() => {
    void (async () => {
      const answer = await fetch('/api/portfolio', { cache: 'no-store' });
      if (answer.ok) {
        setValue((await answer.json()) as PortfolioValue);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const answer = await fetch('/api/positions', { cache: 'no-store' });
      if (!answer.ok) {
        setPositions([]);
        return;
      }
      const body = (await answer.json()) as { positions: PortfolioEntry[] };
      setPositions(body.positions);
    })();
  }, []);

  return (
    <Stack
      gap={20}
      style={{ ...CENTRED_SCREEN, maxWidth: 900 }}
      testId="portfolio-screen"
    >
      <Heading level={1}>{PORTFOLIO_COPY.title}</Heading>

      <Panel>
        <Stack gap={12} style={{ alignItems: 'center', textAlign: 'center' }}>
          {value === null ? (
            <Stack gap={10} style={{ alignItems: 'center', width: '100%' }}>
              <Skeleton width={220} height={44} />
              <Skeleton width={160} height={14} />
              <Skeleton width="100%" height={96} />
            </Stack>
          ) : (
            <>
              <Mono
                testId="portfolio-total"
                style={{ fontSize: 44, fontWeight: 500, lineHeight: 1.1 }}
              >
                {`$${money(value.breakdown.everythingYouHoldUsd)}`}
              </Mono>
              <Muted>{PORTFOLIO_VALUE_COPY.everythingYouHold}</Muted>

              <Row style={{ justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Mono
                  testId="portfolio-change"
                  tone={value.direction === 'down' ? 'caution' : 'accent'}
                >
                  {`${value.changeUsd < 0 ? '−' : '+'}$${money(Math.abs(value.changeUsd))}`}
                </Mono>
                <Mono tone={value.direction === 'down' ? 'caution' : 'accent'}>
                  {`${value.changeBps < 0 ? '−' : '+'}${percent(Math.abs(value.changeBps))}`}
                </Mono>
                <Muted>{PORTFOLIO_VALUE_COPY.inYourPositions}</Muted>
              </Row>

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

      <Panel>
        <Stack gap={14}>
          <Heading level={3}>{PORTFOLIO_COPY.openPositions}</Heading>
          {positions === null ? (
            <Stack gap={10} testId="positions-loading">
              <SkeletonCard lines={5} />
            </Stack>
          ) : null}
          {positions?.length === 0 ? (
            <Muted testId="no-positions">{PORTFOLIO_COPY.noPositions}</Muted>
          ) : null}
          {positions?.map((entry) => (
            <Link
              key={entry.id}
              href={`/app/positions/${entry.id}`}
              data-testid={`position-${entry.id}`}
              style={{ textDecoration: 'none' }}
            >
              <Stack
                gap={10}
                style={{
                  border: '1px solid var(--color-hairline)',
                  borderRadius: 'var(--radius)',
                  padding: 14,
                }}
              >
                <Row>
                  <Heading level={3}>
                    {entry.onChain === null
                      ? (entry.positionAddress ?? COMMON.missingValue)
                      : `${entry.onChain.stockSymbol} → ${entry.onChain.destinationSymbol}`}
                  </Heading>
                  <Mono tone="secondary">{entry.onChain?.state ?? entry.status}</Mono>
                </Row>
                {entry.onChain === null ? null : (
                  <Stack gap={8}>
                    <Figure
                      label={PORTFOLIO_COPY.worth}
                      value={`$${money(inDollars(entry.onChain.collateralValueScaled))}`}
                    />
                    <Row>
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        {PORTFOLIO_COPY.owed}
                      </span>
                      <Mono tone="gold">
                        {money(Number(BigInt(entry.onChain.debtRaw)) / 1e6)} USDC
                      </Mono>
                    </Row>
                    <Figure
                      label={PORTFOLIO_COPY.holding}
                      value={`${money(
                        Number(BigInt(entry.onChain.destinationRaw)) /
                          10 ** entry.onChain.destinationDecimals,
                        4,
                      )} ${entry.onChain.destinationSymbol}`}
                    />
                    <Figure
                      label={PORTFOLIO_COPY.netRate}
                      value={PORTFOLIO_COPY.aYear(percent(entry.onChain.netYieldBps))}
                    />
                    <Figure
                      label={PORTFOLIO_COPY.loanToValue}
                      value={PORTFOLIO_COPY.ofTarget(
                        percent(entry.onChain.loanToValueBps, 0),
                        percent(entry.onChain.targetLtvBps, 0),
                      )}
                    />
                    <Figure
                      label={PORTFOLIO_COPY.liquidatedAt}
                      value={`$${money(
                        entry.onChain.liquidationThresholdBps === 0
                          ? 0
                          : (inDollars(entry.onChain.oraclePriceScaled) *
                              entry.onChain.loanToValueBps) /
                              entry.onChain.liquidationThresholdBps,
                      )}`}
                    />
                  </Stack>
                )}
                {entry.onChain === null ? null : (
                  <HealthBar
                    fillBps={entry.onChain.fillBps}
                    zone={entry.onChain.healthZone}
                    label={PORTFOLIO_COPY.health}
                  />
                )}
                {entry.onChain === null ? null : (
                  <Row>
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      {PORTFOLIO_COPY.guard}
                    </span>
                    <Mono tone="accent">{percent(entry.onChain.protectLtvBps, 0)}</Mono>
                  </Row>
                )}
              </Stack>
            </Link>
          ))}
        </Stack>
      </Panel>

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
