'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';

import {
  Banner,
  Button,
  Mono,
  Muted,
  Row,
  Sheet,
  Stack,
  TransactionLink,
} from '../../components/ui/index.js';
import { COMMON } from '../../copy/common.js';
import { DEPOSIT_COPY } from '../../copy/deposit.js';
import { TOP_UP_COPY } from '../../copy/position.js';
import { money, percent } from '../../client/format.js';
import {
  failureOf,
  readFailure,
  readTheAnswer,
  SubmissionRefused,
  theWalletSaidNo,
  type ReadableFailure,
} from '../../client/failures.js';
import { useSession } from '../../client/session.js';

const SCALED_FRACTION_ONE = 2n ** 60n;
const USDC_DECIMALS = 6;
const DESTINATION_DECIMALS = 9;

interface TopUpSummary {
  readonly stockSymbol: string;
  readonly borrowUsdcRaw: string;
  readonly quotedDestinationRaw: string;
  readonly minimumDestinationRaw: string;
  readonly collateralValueAfterScaled: string;
  readonly debtValueAfterScaled: string;
  readonly loanToValueAfterBps: number;
}

function inDollars(scaled: string): number {
  return Number(BigInt(scaled)) / Number(SCALED_FRACTION_ONE);
}

// Growing a position the wallet already holds. The server decides the borrow from the target the
// position already carries, so this sheet only states what it will do.
export function TopUpSheet({
  open,
  positionId,
  collateralAmountRaw,
  onClose,
  onDone,
}: {
  open: boolean;
  positionId: string;
  collateralAmountRaw: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { signAndSubmit, headersForABuild, networkName } = useSession();
  const [summary, setSummary] = useState<TopUpSummary | null>(null);
  const [transactions, setTransactions] = useState<readonly string[] | null>(null);
  const [buildId, setBuildId] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<ReadableFailure | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSummary(null);
    setTransactions(null);
    setFailure(null);
    setSignature(null);
    void (async () => {
      const answer = await fetch(`/api/positions/${positionId}/top-up/build`, {
        method: 'POST',
        headers: headersForABuild(),
        body: JSON.stringify({ amountRaw: collateralAmountRaw }),
      });
      const body = await readTheAnswer<{
        buildId?: string;
        transaction?: readonly { transaction: string }[];
        summary?: TopUpSummary;
      }>(answer);
      if (!answer.ok || body.transaction === undefined) {
        setFailure(readFailure(body) ?? failureOf('somethingWentWrong'));
        return;
      }
      setSummary(body.summary ?? null);
      setTransactions(body.transaction.map((one) => one.transaction));
      setBuildId(body.buildId);
    })();
  }, [open, positionId, collateralAmountRaw, headersForABuild]);

  const sign = useCallback(async (): Promise<void> => {
    if (transactions === null) {
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      setSignature(await signAndSubmit(transactions, buildId));
      onDone();
    } catch (thrown) {
      setFailure(
        theWalletSaidNo(thrown)
          ? failureOf('signatureRejected', thrown)
          : thrown instanceof SubmissionRefused
            ? thrown.failure
            : failureOf('somethingWentWrong', thrown),
      );
    } finally {
      setBusy(false);
    }
  }, [transactions, buildId, signAndSubmit, onDone]);

  return (
    <Sheet title={TOP_UP_COPY.title} open={open} testId="top-up-sheet" onClose={onClose}>
      <Stack gap={14}>
        <Muted>{TOP_UP_COPY.note}</Muted>
        {failure === null ? null : (
          <Banner tone="caution" testId="top-up-failure">
            {failure.sentence}
          </Banner>
        )}
        {summary === null && failure === null ? <Muted>{COMMON.loading}</Muted> : null}

        {summary === null ? null : (
          <Stack gap={10}>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {DEPOSIT_COPY.youBorrow}
              </span>
              <Mono testId="top-up-borrow">
                {money(Number(BigInt(summary.borrowUsdcRaw)) / 10 ** USDC_DECIMALS)} USDC
              </Mono>
            </Row>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {DEPOSIT_COPY.youReceive}
              </span>
              <Mono tone="gold" testId="top-up-destination">
                {money(
                  Number(BigInt(summary.minimumDestinationRaw)) /
                    10 ** DESTINATION_DECIMALS,
                  4,
                )}
              </Mono>
            </Row>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {DEPOSIT_COPY.holdsAfter}
              </span>
              <Mono testId="top-up-holds-after">
                {money(inDollars(summary.collateralValueAfterScaled))}
              </Mono>
            </Row>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {DEPOSIT_COPY.owesAfter}
              </span>
              <Mono testId="top-up-owes-after">
                {money(inDollars(summary.debtValueAfterScaled))}
              </Mono>
            </Row>
            <Row>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {DEPOSIT_COPY.loanToValueAfter}
              </span>
              <Mono testId="top-up-ltv-after">
                {percent(summary.loanToValueAfterBps, 0)}
              </Mono>
            </Row>
            <Muted>{DEPOSIT_COPY.guardStaysTheSame}</Muted>
          </Stack>
        )}

        {signature === null ? (
          <Button
            testId="top-up-sign"
            disabled={transactions === null || busy}
            onClick={() => void sign()}
          >
            {busy ? TOP_UP_COPY.working : TOP_UP_COPY.confirm}
          </Button>
        ) : (
          <TransactionLink
            signature={signature}
            cluster={networkName}
            testId="top-up-signature"
          />
        )}
        <Button tone="link" onClick={onClose}>
          {COMMON.close}
        </Button>
      </Stack>
    </Sheet>
  );
}
