'use client';

import { useEffect, useState, type JSX } from 'react';

import {
  CENTRED_SCREEN,
  Heading,
  Mono,
  Muted,
  Panel,
  Row,
  SkeletonRows,
  Stack,
  NumbersInMono,
  transactionUrl,
} from '../../../components/ui/index.js';
import { useSession } from '../../../client/session.js';
import { ACTIVITY_COPY } from '../../../copy/activity.js';
import { money } from '../../../client/format.js';

const USDC_DECIMALS = 6;

interface ActivityEntry {
  readonly signature: string;
  readonly positionAddress: string;
  readonly kind: 'protect' | 'grow' | 'leave' | 'top-up';
  readonly usdcAmountRaw: string | null;
  readonly caller: string | null;
  readonly at: string;
}

const DOT: Readonly<Record<ActivityEntry['kind'], string>> = {
  protect: 'var(--color-accent)',
  grow: 'var(--color-accent)',
  leave: 'var(--color-gold)',
  'top-up': '#4A453F',
};

const WHAT: Readonly<Record<ActivityEntry['kind'], string>> = {
  protect: ACTIVITY_COPY.protect,
  grow: ACTIVITY_COPY.grow,
  leave: ACTIVITY_COPY.leave,
  'top-up': ACTIVITY_COPY['top-up'],
};

export default function ActivityPage(): JSX.Element {
  const { networkName } = useSession();
  const [events, setEvents] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const answer = await fetch('/api/activity', { cache: 'no-store' });
      if (!answer.ok) {
        setEvents([]);
        return;
      }
      const body = (await answer.json()) as { events: ActivityEntry[] };
      setEvents(body.events);
    })();
  }, []);

  return (
    <Stack gap={20} style={{ ...CENTRED_SCREEN, maxWidth: 900 }} testId="activity-screen">
      <Heading level={1}>{ACTIVITY_COPY.title}</Heading>

      {events === null ? (
        <Panel>
          <SkeletonRows rows={6} height={16} testId="activity-loading" />
        </Panel>
      ) : null}
      {events !== null && events.length === 0 ? (
        <Panel>
          <Muted>{ACTIVITY_COPY.empty}</Muted>
        </Panel>
      ) : null}

      {events !== null && events.length > 0 ? (
        <Panel>
          <Stack gap={12}>
            {events.map((entry) => (
              <Row
                key={entry.signature}
                testId={`activity-${entry.kind}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: '6px 14px',
                  alignItems: 'baseline',
                  padding: '10px 0',
                  borderTop: '1px solid rgba(255,255,255,.06)',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: DOT[entry.kind],
                    position: 'relative',
                    top: -1,
                  }}
                />
                <span style={{ fontSize: 14, lineHeight: 1.5 }}>
                  <NumbersInMono
                    sentence={ACTIVITY_COPY.line(
                      WHAT[entry.kind],
                      entry.usdcAmountRaw === null
                        ? ''
                        : ACTIVITY_COPY.forAmount(
                            money(
                              Number(BigInt(entry.usdcAmountRaw)) / 10 ** USDC_DECIMALS,
                            ),
                          ),
                      entry.caller === null ? '' : ACTIVITY_COPY.byCaller(entry.caller),
                    )}
                  />
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  <a
                    href={transactionUrl(entry.signature, networkName)}
                    target="_blank"
                    rel="noreferrer noopener"
                    data-testid={`activity-transaction-${entry.signature}`}
                  >
                    <Mono tone="secondary">
                      {new Date(entry.at).toLocaleString('en-GB')}
                    </Mono>
                  </a>
                </span>
              </Row>
            ))}
          </Stack>
        </Panel>
      ) : null}
    </Stack>
  );
}
