'use client';

import { useEffect, useState, type JSX } from 'react';

import { Heading, Mono, Muted, Panel, Row, Stack } from '../../../components/ui/index.js';
import { ACTIVITY_COPY } from '../../../copy/activity.js';
import { COMMON } from '../../../copy/common.js';
import { money } from '../../../client/format.js';

const USDC_DECIMALS = 6;

interface ActivityEntry {
  readonly signature: string;
  readonly positionAddress: string;
  readonly kind: 'protect' | 'grow' | 'leave';
  readonly usdcAmountRaw: string | null;
  readonly at: string;
}

const COLUMNS = {
  display: 'grid',
  gridTemplateColumns: '1.3fr 1.7fr 1fr 0.7fr',
} as const;

const WHAT: Readonly<Record<ActivityEntry['kind'], string>> = {
  protect: ACTIVITY_COPY.protect,
  grow: ACTIVITY_COPY.grow,
  leave: ACTIVITY_COPY.leave,
};

export default function ActivityPage(): JSX.Element {
  const [events, setEvents] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const answer = await fetch('/api/activity');
      if (!answer.ok) {
        setEvents([]);
        return;
      }
      const body = (await answer.json()) as { events: ActivityEntry[] };
      setEvents(body.events);
    })();
  }, []);

  return (
    <Stack gap={20} style={{ maxWidth: 900 }} testId="activity-screen">
      <Heading level={1}>{ACTIVITY_COPY.title}</Heading>

      {events === null ? <Muted>{COMMON.loading}</Muted> : null}
      {events !== null && events.length === 0 ? (
        <Panel>
          <Muted>{ACTIVITY_COPY.empty}</Muted>
        </Panel>
      ) : null}

      {events !== null && events.length > 0 ? (
        <Panel>
          <Stack gap={12}>
            <Row style={COLUMNS}>
              <Muted>{ACTIVITY_COPY.columnWhen}</Muted>
              <Muted>{ACTIVITY_COPY.columnWhat}</Muted>
              <Muted>{ACTIVITY_COPY.columnAmount}</Muted>
              <Muted>{ACTIVITY_COPY.columnTransaction}</Muted>
            </Row>
            {events.map((entry) => (
              <Row
                key={entry.signature}
                style={COLUMNS}
                testId={`activity-${entry.kind}`}
              >
                <Mono tone="secondary">{new Date(entry.at).toLocaleString('en-GB')}</Mono>
                <span>{WHAT[entry.kind]}</span>
                <Mono tone="gold">
                  {entry.usdcAmountRaw === null
                    ? COMMON.missingValue
                    : `${money(Number(BigInt(entry.usdcAmountRaw)) / 10 ** USDC_DECIMALS)} USDC`}
                </Mono>
                <Mono tone="secondary">
                  {entry.signature.slice(0, 4)}…{entry.signature.slice(-4)}
                </Mono>
              </Row>
            ))}
          </Stack>
        </Panel>
      ) : null}
    </Stack>
  );
}
