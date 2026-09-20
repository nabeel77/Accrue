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
  TransactionLink,
} from '../../../components/ui/index.js';
import { useSession } from '../../../client/session.js';
import { ACTIVITY_COPY } from '../../../copy/activity.js';
import { COMMON } from '../../../copy/common.js';
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

const COLUMNS = {
  display: 'grid',
  gridTemplateColumns: '1.3fr 1.7fr 1fr 0.8fr 0.7fr',
} as const;

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
            <Row style={COLUMNS}>
              <Muted>{ACTIVITY_COPY.columnWhen}</Muted>
              <Muted>{ACTIVITY_COPY.columnWhat}</Muted>
              <Muted>{ACTIVITY_COPY.columnAmount}</Muted>
              <Muted>{ACTIVITY_COPY.columnCaller}</Muted>
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
                <Mono tone="secondary" testId={`activity-caller-${entry.signature}`}>
                  {entry.caller ?? COMMON.missingValue}
                </Mono>
                <TransactionLink signature={entry.signature} cluster={networkName} />
              </Row>
            ))}
          </Stack>
        </Panel>
      ) : null}
    </Stack>
  );
}
