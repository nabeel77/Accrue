'use client';

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import {
  Banner,
  Button,
  Mono,
  Muted,
  Panel,
  Row,
  Stack,
  TransactionLink,
} from '../../components/ui/index.js';
import { ACTIVITY_COPY } from '../../copy/activity.js';
import { DEVNET } from '../../copy/common.js';
import { howLongAgo, money } from '../../client/format.js';
import {
  failureOf,
  readFailure,
  readTheAnswer,
  type ReadableFailure,
} from '../../client/failures.js';

const A_DROP_PERCENT = -25;
const A_LIFT_PERCENT = 25;
const HOW_OFTEN_THE_GUARD_IS_LOOKED_FOR = 5_000;
const HOW_LONG_THE_GUARD_IS_WAITED_FOR = 10 * 60 * 1_000;
const A_SECOND = 1_000;

interface GuardEvent {
  readonly signature: string;
  readonly positionAddress: string;
  readonly kind: 'protect' | 'grow' | 'leave' | 'top-up';
  readonly at: string;
}

const WHAT: Readonly<Record<GuardEvent['kind'], string>> = {
  protect: ACTIVITY_COPY.protect,
  grow: ACTIVITY_COPY.grow,
  leave: ACTIVITY_COPY.leave,
  'top-up': ACTIVITY_COPY['top-up'],
};

// The sandbox only. Three buttons that move what the oracle says this stock is worth, so the
// guard can be watched doing its work without waiting for a real market.
export function DevnetMarketBlock({
  stockSymbol,
  positionAddress,
  onMoved,
}: {
  stockSymbol: string;
  positionAddress: string;
  onMoved: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReadableFailure | null>(null);
  const [moved, setMoved] = useState<{ from: number; to: number } | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [acted, setActed] = useState<GuardEvent | null>(null);
  const askedAt = useRef(0);

  const ask = useCallback(
    async (asked: Record<string, unknown>, thenWaitForTheGuard: boolean) => {
      setBusy(true);
      setFailure(null);
      setActed(null);
      setMoved(null);
      try {
        const answer = await fetch('/api/devnet/prices', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(asked),
        });
        const body = await readTheAnswer<{ from?: number; to?: number }>(answer);
        if (!answer.ok) {
          setFailure(
            readFailure(body) ?? {
              code: 'somethingWentWrong',
              sentence: DEVNET.marketMoveFailed,
            },
          );
          return;
        }
        if (body.from !== undefined && body.to !== undefined) {
          setMoved({ from: body.from, to: body.to });
        }
        askedAt.current = Date.now();
        setWaitingSince(thenWaitForTheGuard ? Date.now() : null);
        onMoved();
      } catch (thrown) {
        setFailure(failureOf('somethingWentWrong', thrown));
      } finally {
        setBusy(false);
      }
    },
    [onMoved],
  );

  // A drop is only interesting because of what the guard does next, so the screen keeps asking
  // for this position's events until one lands that is newer than the drop.
  useEffect(() => {
    if (waitingSince === null) {
      return;
    }
    const look = async (): Promise<void> => {
      if (Date.now() - waitingSince > HOW_LONG_THE_GUARD_IS_WAITED_FOR) {
        setWaitingSince(null);
        return;
      }
      const answer = await fetch('/api/activity', { cache: 'no-store' });
      if (!answer.ok) {
        return;
      }
      const body = (await answer.json()) as { events: GuardEvent[] };
      const found = body.events.find(
        (entry) =>
          entry.positionAddress === positionAddress &&
          entry.kind !== 'top-up' &&
          new Date(entry.at).getTime() > askedAt.current,
      );
      if (found !== undefined) {
        setActed(found);
        setWaitingSince(null);
        onMoved();
      }
    };
    const again = setInterval(() => {
      void look();
    }, HOW_OFTEN_THE_GUARD_IS_LOOKED_FOR);
    return () => {
      clearInterval(again);
    };
  }, [waitingSince, positionAddress, onMoved]);

  return (
    <Panel>
      <Stack gap={12}>
        <Muted>{DEVNET.moveTheMarket}</Muted>
        <Row style={{ justifyContent: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <Button
            tone="quiet"
            testId="devnet-drop"
            disabled={busy}
            onClick={() => {
              void ask({ symbol: stockSymbol, percent: A_DROP_PERCENT }, true);
            }}
          >
            {busy ? DEVNET.movingTheMarket : DEVNET.dropTheStock(stockSymbol)}
          </Button>
          <Button
            tone="quiet"
            testId="devnet-lift"
            disabled={busy}
            onClick={() => {
              void ask({ symbol: stockSymbol, percent: A_LIFT_PERCENT }, true);
            }}
          >
            {busy ? DEVNET.movingTheMarket : DEVNET.liftTheStock(stockSymbol)}
          </Button>
          <Button
            tone="quiet"
            testId="devnet-reset"
            disabled={busy}
            onClick={() => {
              void ask({ reset: true }, false);
            }}
          >
            {DEVNET.resetPrices}
          </Button>
        </Row>
        {failure === null ? null : (
          <Banner tone="caution" testId="devnet-move-failed">
            {failure.sentence}
          </Banner>
        )}
        {moved === null ? null : (
          <Mono testId="devnet-moved">
            {DEVNET.marketMoved(stockSymbol, money(moved.from), money(moved.to))}
          </Mono>
        )}
        {waitingSince === null ? null : (
          <Muted testId="devnet-waiting">{DEVNET.waitingForTheGuard}</Muted>
        )}
        {acted === null ? null : (
          <Row testId="devnet-guard-acted">
            <span>
              {DEVNET.theGuardActed(
                WHAT[acted.kind],
                howLongAgo((Date.now() - new Date(acted.at).getTime()) / A_SECOND),
              )}
            </span>
            <TransactionLink signature={acted.signature} cluster="devnet" />
          </Row>
        )}
      </Stack>
    </Panel>
  );
}
