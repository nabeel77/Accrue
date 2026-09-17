'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';

import {
  Banner,
  Button,
  GuardCard,
  Heading,
  HealthBar,
  Mono,
  Muted,
  Panel,
  Row,
  Sheet,
  Stack,
} from '../../../../components/ui/index.js';
import { BANNERS, CLOSING_COPY, POSITION_LABELS } from '../../../../copy/banners.js';
import { COMMON } from '../../../../copy/common.js';
import { POSITION_COPY } from '../../../../copy/position.js';
import { ago, money, percent } from '../../../../client/format.js';
import { useSession } from '../../../../client/session.js';

interface OnChain {
  readonly address: string;
  readonly state: 'AwaitingSwap' | 'Open' | 'Closing' | 'Closed';
  readonly loanToValueBps: number;
  readonly protectLtvBps: number;
  readonly targetLtvBps: number;
  readonly liquidationThresholdBps: number;
  readonly healthZone: 'healthy' | 'caution' | 'danger';
  readonly fillBps: number;
  readonly distanceToLiquidationBps: number;
  readonly debtRaw: string;
  readonly debtIsLive: boolean;
  readonly owedAtLeaveRaw: string;
  readonly oraclePriceScaled: string;
  readonly borrowRateBps: number;
  readonly lastProtectAt: string;
}

const SCALED_FRACTION_ONE = 2n ** 60n;

export default function PositionPage(): JSX.Element {
  const parameters = useParams<{ id: string }>();
  const { signAndSubmit } = useSession();
  const [onChain, setOnChain] = useState<OnChain | null>(null);
  const [keepers, setKeepers] = useState(0);
  const [closing, setClosing] = useState<{
    sentence: string;
    estimateLabel: string;
    neededFromTheWalletRaw: string;
  } | null>(null);
  const [closingOpen, setClosingOpen] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const answer = await fetch(`/api/positions/${parameters.id}`);
    if (!answer.ok) {
      return;
    }
    const body = (await answer.json()) as { onChain: OnChain | null };
    setOnChain(body.onChain);
    const program = await fetch('/api/program');
    const programBody = (await program.json()) as { keepersLastHour?: number };
    setKeepers(programBody.keepersLastHour ?? 0);
  }, [parameters.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openClosing = useCallback(async (): Promise<void> => {
    const answer = await fetch(`/api/positions/${parameters.id}/unwind/build`, {
      method: 'POST',
    });
    if (answer.ok) {
      const body = (await answer.json()) as {
        closing: {
          sentence: string;
          estimateLabel: string;
          neededFromTheWalletRaw: string;
        };
      };
      setClosing(body.closing);
    }
    setClosingOpen(true);
  }, [parameters.id]);

  const repayAndClose = useCallback(async (): Promise<void> => {
    if (onChain === null) {
      return;
    }
    const answer = await fetch(`/api/positions/${parameters.id}/repay/build`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountRaw: onChain.debtRaw }),
    });
    if (!answer.ok) {
      return;
    }
    const body = (await answer.json()) as { transaction: { transaction: string } };
    setSignature(await signAndSubmit([body.transaction.transaction]));
    await load();
  }, [onChain, parameters.id, signAndSubmit, load]);

  if (onChain === null) {
    return <Muted>{COMMON.loading}</Muted>;
  }

  const price = Number(BigInt(onChain.oraclePriceScaled)) / Number(SCALED_FRACTION_ONE);
  const liquidationPrice =
    onChain.liquidationThresholdBps === 0
      ? 0
      : (price * onChain.loanToValueBps) / onChain.liquidationThresholdBps;
  const distance = percent(onChain.distanceToLiquidationBps, 0);
  const debtWhole = Number(BigInt(onChain.debtRaw)) / 1e6;

  return (
    <Stack gap={20} style={{ maxWidth: 780 }} testId="position-screen">
      <Heading level={1}>{onChain.address.slice(0, 8)}…</Heading>

      {onChain.state === 'Closing' ? (
        <Banner tone="caution" testId="closing-banner">
          <Stack gap={8}>
            <strong>{POSITION_COPY.closingTitle}</strong>
            <span>{POSITION_COPY.closingNote}</span>
            <Row>
              <span>{POSITION_COPY.stillOwed}</span>
              <Mono tone="gold" testId="still-owed">
                {money(debtWhole)} USDC
              </Mono>
            </Row>
            {onChain.debtIsLive ? null : (
              <Muted>{POSITION_COPY.liveDebtUnavailable}</Muted>
            )}
            <div>
              <Button testId="repay-and-close" onClick={() => void repayAndClose()}>
                {POSITION_COPY.repayAndClose}
              </Button>
            </div>
          </Stack>
        </Banner>
      ) : null}

      {onChain.healthZone === 'danger' ? (
        <Banner tone="danger" testId="danger-banner">
          {BANNERS.danger(
            distance,
            percent(onChain.protectLtvBps, 0),
            ago(Number(onChain.lastProtectAt)),
          )}
        </Banner>
      ) : null}
      {onChain.healthZone === 'caution' ? (
        <Banner tone="caution" testId="caution-banner">
          {BANNERS.caution(distance)}
        </Banner>
      ) : null}

      <Panel>
        <Stack gap={14}>
          <HealthBar fillBps={onChain.fillBps} zone={onChain.healthZone} />
          <Row>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {POSITION_COPY.liquidationPrice}
            </span>
            <Mono>{money(liquidationPrice)}</Mono>
          </Row>
          <Row>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {POSITION_COPY.distanceToLiquidation}
            </span>
            <Mono>{distance}</Mono>
          </Row>
          <Muted>
            {POSITION_LABELS.borrowed(
              money(debtWhole),
              (onChain.borrowRateBps / 100).toFixed(2),
            )}
          </Muted>
          <Muted>{POSITION_LABELS.price(money(price), 'read just now')}</Muted>
        </Stack>
      </Panel>

      <GuardCard
        status={onChain.healthZone}
        repaysAt={percent(onChain.protectLtvBps, 0)}
        lastAction={ago(Number(onChain.lastProtectAt))}
        keepersLastHour={`${keepers}`}
        parameters={[
          { label: 'Target', value: percent(onChain.targetLtvBps, 0) },
          { label: 'Guard', value: percent(onChain.protectLtvBps, 0) },
          {
            label: 'Liquidation threshold',
            value: percent(onChain.liquidationThresholdBps, 0),
          },
        ]}
        onProtectNow={() => {
          void fetch(`/api/positions/${parameters.id}/protect/build`, { method: 'POST' });
        }}
      />

      <Row style={{ justifyContent: 'flex-start', gap: 12 }}>
        <Button tone="quiet">{POSITION_COPY.addCollateral}</Button>
        <Button tone="quiet">{POSITION_COPY.repay}</Button>
        <Button tone="quiet" testId="unwind" onClick={() => void openClosing()}>
          {POSITION_COPY.unwind}
        </Button>
      </Row>

      <Sheet title={POSITION_COPY.unwind} open={closingOpen} testId="closing-sheet">
        <Stack gap={12}>
          <p style={{ margin: 0, color: 'var(--color-text)' }}>
            {closing?.sentence ?? CLOSING_COPY.shortfallSentence}
          </p>
          <Row>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {CLOSING_COPY.estimateLabel}
            </span>
            <Mono tone="gold" testId="closing-estimate">
              {closing === null
                ? COMMON.missingValue
                : `${money(Number(BigInt(closing.neededFromTheWalletRaw)) / 1e6)} USDC`}
            </Mono>
          </Row>
          <Button
            tone="link"
            onClick={() => {
              setClosingOpen(false);
            }}
          >
            {COMMON.close}
          </Button>
        </Stack>
      </Sheet>

      {signature === null ? null : (
        <Mono tone="accent" style={{ wordBreak: 'break-all' }}>
          {signature}
        </Mono>
      )}
    </Stack>
  );
}
