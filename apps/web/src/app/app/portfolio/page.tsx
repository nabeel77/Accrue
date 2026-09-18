'use client';

import Link from 'next/link';
import { useEffect, useState, type JSX } from 'react';

import {
  CENTRED_SCREEN,
  Heading,
  HealthBar,
  Mono,
  Muted,
  Panel,
  Row,
  Stack,
} from '../../../components/ui/index.js';
import { COMMON } from '../../../copy/common.js';
import { PORTFOLIO_COPY } from '../../../copy/portfolio.js';
import { money, percent } from '../../../client/format.js';

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
        <Stack gap={14}>
          <Heading level={3}>{PORTFOLIO_COPY.openPositions}</Heading>
          {positions === null ? <Muted>{COMMON.loading}</Muted> : null}
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
    </Stack>
  );
}
