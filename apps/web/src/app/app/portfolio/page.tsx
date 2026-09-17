'use client';

import Link from 'next/link';
import { useEffect, useState, type JSX } from 'react';

import {
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
    readonly loanToValueBps: number;
    readonly healthZone: 'healthy' | 'caution' | 'danger';
    readonly fillBps: number;
    readonly debtRaw: string;
    readonly protectLtvBps: number;
  } | null;
}

export default function PortfolioPage(): JSX.Element {
  const [positions, setPositions] = useState<PortfolioEntry[] | null>(null);

  useEffect(() => {
    void (async () => {
      const answer = await fetch('/api/positions');
      if (!answer.ok) {
        setPositions([]);
        return;
      }
      const body = (await answer.json()) as { positions: PortfolioEntry[] };
      setPositions(body.positions);
    })();
  }, []);

  return (
    <Stack gap={20} style={{ maxWidth: 900 }} testId="portfolio-screen">
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
                  <Mono>{entry.positionAddress ?? COMMON.missingValue}</Mono>
                  <Mono tone="secondary">{entry.onChain?.state ?? entry.status}</Mono>
                </Row>
                <Row>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    {PORTFOLIO_COPY.owed}
                  </span>
                  <Mono tone="gold">
                    {entry.onChain === null
                      ? COMMON.missingValue
                      : money(Number(BigInt(entry.onChain.debtRaw)) / 1e6)}
                  </Mono>
                </Row>
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
