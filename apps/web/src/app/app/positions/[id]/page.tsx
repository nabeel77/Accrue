'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  AmountField,
  Banner,
  Button,
  CENTRED_SCREEN,
  GuardCard,
  Heading,
  HealthBar,
  Mono,
  Muted,
  NumbersInMono,
  Panel,
  Row,
  Explainer,
  Sheet,
  Slider,
  Stack,
  Toggle,
  TransactionLink,
} from '../../../../components/ui/index.js';
import {
  BANNERS,
  CLOSING_COPY,
  POSITION_LABELS,
  TEST_USDC_COPY,
} from '../../../../copy/banners.js';
import {
  A_LINE_IN_BOTH_UNITS,
  AMOUNT_FIELD_COPY,
  COMMON,
} from '../../../../copy/common.js';
import {
  ACTION_COPY,
  AMOUNT_SHEET_COPY,
  BORROW_MORE_COPY,
  TOP_UP_COPY,
  GUARD_FIELD_COPY,
  GUARD_PARAMETER_LABELS,
  POSITION_COPY,
} from '../../../../copy/position.js';
import { FAILURE_COPY, FAILURE_DETAILS } from '../../../../copy/errors.js';
import {
  ago,
  howLong,
  howLongAgo,
  money,
  percent,
  rawFromTypedAmount,
  rawToWhole,
} from '../../../../client/format.js';
import {
  failureOf,
  readFailure,
  readTheAnswer,
  type ReadableFailure,
} from '../../../../client/failures.js';
import { borrowMoreLines } from '../../../../client/borrowMoreLines.js';
import { theGuardLine, theLiquidationLine } from '@accrue/core/price-fall';
import { useSession } from '../../../../client/session.js';
import { useSubmit } from '../../../../client/useSubmit.js';
import { DevnetMarketBlock } from '../../DevnetMarketBlock.js';
import { TopUpSheet } from '../../TopUpSheet.js';

interface OnChain {
  readonly address: string;
  readonly state: 'AwaitingSwap' | 'Open' | 'Closing' | 'Closed';
  readonly stockSymbol: string;
  readonly destinationSymbol: string;
  readonly destinationDecimals: number;
  readonly destinationRateBps: number;
  readonly netYieldBps: number;
  readonly collateralRaw: string;
  readonly destinationRaw: string;
  readonly collateralValueScaled: string;
  readonly loanToValueBps: number;
  readonly protectLtvBps: number;
  readonly targetLtvBps: number;
  readonly growBelowLtvBps: number;
  readonly growEnabled: boolean;
  readonly liquidationThresholdBps: number;
  readonly healthZone: 'healthy' | 'caution' | 'danger';
  readonly fillBps: number;
  readonly distanceToLiquidationBps: number;
  readonly fallToLiquidationBps: number;
  readonly debtRaw: string;
  readonly debtIsLive: boolean;
  readonly collateralDecimals: number;
  readonly borrowDecimals: number;
  readonly ownerBorrowBalanceRaw: string;
  readonly ownerCollateralBalanceRaw: string;
  readonly oraclePriceScaled: string;
  readonly oraclePriceAgeSeconds: number;
  readonly oraclePriceIsTooOld: boolean;
  readonly borrowRateBps: number;
  readonly lastProtectAt: string;
  readonly protectCount: number;
  readonly protectIntervalSeconds: number;
}

interface Stored {
  readonly collateralPriceAtOpen: string | null;
}

interface LastCheck {
  readonly at: string;
  readonly keeper: string | null;
}

interface Closing {
  readonly sentence: string;
  readonly estimateLabel: string;
  readonly neededFromTheWalletRaw: string | null;
}

const SCALED_FRACTION_ONE = 2n ** 60n;

function secondsUntilTheGuardCanActAgain(onChain: OnChain): number {
  const lastProtectAt = Number(onChain.lastProtectAt);
  if (lastProtectAt === 0 || onChain.protectIntervalSeconds === 0) {
    return 0;
  }
  const readyAt = lastProtectAt + onChain.protectIntervalSeconds;
  return Math.max(readyAt - Math.floor(Date.now() / A_SECOND), 0);
}

function whatTheGuardIsDoing(onChain: OnChain): string {
  const waitingFor = secondsUntilTheGuardCanActAgain(onChain);
  if (waitingFor > 0) {
    return BANNERS.guardRepaidAndWaits(
      howLongAgo(Math.floor(Date.now() / A_SECOND) - Number(onChain.lastProtectAt)),
      howLong(waitingFor),
    );
  }
  return onChain.protectCount === 0
    ? `${BANNERS.guardHasNotActedYet} ${BANNERS.guardActsNext}`
    : BANNERS.guardActsNext;
}

function percentChange(then: number, now: number): string {
  if (then <= 0) {
    return COMMON.missingValue;
  }
  const move = ((now - then) / then) * 100;
  return `${move >= 0 ? '+' : '−'}${Math.abs(move).toFixed(1)}%`;
}

function inDollars(scaled: string): number {
  return Number(BigInt(scaled)) / Number(SCALED_FRACTION_ONE);
}

function BigNumber({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note: string;
  testId: string;
}): JSX.Element {
  return (
    <Row style={{ alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <Mono style={{ fontSize: 22, fontWeight: 500 }} testId={testId}>
          {value}
        </Mono>
        <Mono tone="muted" style={{ fontSize: 12 }}>
          {note}
        </Mono>
      </span>
    </Row>
  );
}
const HOW_OFTEN_THE_SCREEN_READS_AGAIN = 4_000;
const A_SECOND = 1_000;
// Past this, the guard is not being run often enough for anyone to rely on it.
const HOW_LONG_WITHOUT_A_KEEPER_IS_TOO_LONG_MINUTES = 5;

export default function PositionPage(): JSX.Element {
  const parameters = useParams<{ id: string }>();
  const { headersForABuild, networkName } = useSession();
  const [onChain, setOnChain] = useState<OnChain | null>(null);
  const [read, setRead] = useState<'waiting' | 'read' | 'nothing on the chain'>(
    'waiting',
  );
  const [lastCheck, setLastCheck] = useState<LastCheck | null>(null);
  const [stored, setStored] = useState<Stored | null>(null);
  const [cluster, setCluster] = useState<'devnet' | 'mainnet' | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [closingFailure, setClosingFailure] = useState<ReadableFailure | null>(null);
  const [sheet, setSheet] = useState<
    'none' | 'close' | 'add' | 'repay' | 'guard' | 'top-up' | 'top-up-review'
  >('none');
  const [amount, setAmount] = useState('');
  const [faucet, setFaucet] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const closeTheSheet = useCallback((): void => {
    setSheet('none');
  }, []);

  const askTheFaucetForUsdc = useCallback(async (): Promise<void> => {
    setFaucet('sending');
    const answer = await fetch('/api/devnet/faucet', { method: 'POST' });
    setFaucet(answer.ok ? 'sent' : 'failed');
  }, []);
  const [guard, setGuard] = useState({
    target: 0,
    protect: 0,
    grow: 0,
    borrowMore: false,
  });

  const load = useCallback(async (): Promise<void> => {
    const answer = await fetch(`/api/positions/${parameters.id}`, { cache: 'no-store' });
    if (!answer.ok) {
      return;
    }
    const body = (await answer.json()) as {
      onChain: OnChain | null;
      lastCheck: LastCheck | null;
      position: Stored | null;
    };
    setOnChain(body.onChain);
    setLastCheck(body.lastCheck);
    setStored(body.position);
    setRead(body.onChain === null ? 'nothing on the chain' : 'read');
    // A refresh never overwrites what somebody is part way through typing.
    if (body.onChain !== null && sheet !== 'guard') {
      setGuard({
        target: body.onChain.targetLtvBps,
        protect: body.onChain.protectLtvBps,
        grow: body.onChain.growBelowLtvBps,
        borrowMore: body.onChain.growEnabled,
      });
    }
    const program = await fetch('/api/program', { cache: 'no-store' });
    const programBody = (await program.json()) as { cluster?: 'devnet' | 'mainnet' };
    setCluster(programBody.cluster ?? null);
  }, [parameters.id, sheet]);

  const reload = useCallback((): void => {
    void load();
  }, [load]);

  const submit = useSubmit(() => {
    setSheet('none');
    void load();
  });

  // A price age that never moves is not an age, so the screen reads the chain again on a beat.
  useEffect(() => {
    void load();
    const again = setInterval(() => {
      void load();
    }, HOW_OFTEN_THE_SCREEN_READS_AGAIN);
    return () => {
      clearInterval(again);
    };
  }, [load]);

  const openClosing = useCallback(async (): Promise<void> => {
    setSheet('close');
    setClosing(null);
    setClosingFailure(null);
    const answer = await fetch(`/api/positions/${parameters.id}/unwind/build`, {
      method: 'POST',
      headers: headersForABuild(),
      body: '{}',
    });
    const body = await readTheAnswer<{ closing?: Closing }>(answer);
    if (answer.ok) {
      setClosing(body.closing ?? null);
      return;
    }
    setClosingFailure(readFailure(body) ?? failureOf('somethingWentWrong'));
  }, [parameters.id, headersForABuild]);

  if (onChain === null) {
    // A row of ours with no account on the chain is a position that has already been closed.
    return read === 'waiting' ? (
      <Muted>{COMMON.loading}</Muted>
    ) : (
      <Stack
        gap={16}
        style={{ ...CENTRED_SCREEN, maxWidth: 780 }}
        testId="position-finished"
      >
        <Heading level={1}>{POSITION_COPY.finished}</Heading>
        <Banner tone="notice">{POSITION_COPY.finishedNote}</Banner>
        <Link href="/app/portfolio">{POSITION_COPY.backToPortfolio}</Link>
      </Stack>
    );
  }

  const price = Number(BigInt(onChain.oraclePriceScaled)) / Number(SCALED_FRACTION_ONE);
  const liquidationPrice =
    onChain.liquidationThresholdBps === 0
      ? 0
      : (price * onChain.loanToValueBps) / onChain.liquidationThresholdBps;
  const distance = percent(onChain.fallToLiquidationBps, 0);
  const debtWhole = rawToWhole(onChain.debtRaw, onChain.borrowDecimals);
  const working = submit.state === 'signing' || submit.state === 'pending';
  const usdcInTheWallet = rawToWhole(
    onChain.ownerBorrowBalanceRaw,
    onChain.borrowDecimals,
  );
  const stockInTheWallet = rawToWhole(
    onChain.ownerCollateralBalanceRaw,
    onChain.collateralDecimals,
  );
  const theMostThatCanBeRepaid = Math.min(debtWhole, usdcInTheWallet);
  const sinceTheLastCheckSeconds =
    lastCheck === null
      ? null
      : (Date.now() - new Date(lastCheck.at).getTime()) / A_SECOND;
  const noKeeperSeen =
    sinceTheLastCheckSeconds === null ||
    sinceTheLastCheckSeconds > HOW_LONG_WITHOUT_A_KEEPER_IS_TOO_LONG_MINUTES * 60
      ? POSITION_COPY.noKeeperSeen(
          `${Math.max(
            Math.floor((sinceTheLastCheckSeconds ?? 0) / 60),
            HOW_LONG_WITHOUT_A_KEEPER_IS_TOO_LONG_MINUTES,
          )}`,
        )
      : null;

  return (
    <Stack gap={20} style={{ ...CENTRED_SCREEN, maxWidth: 780 }} testId="position-screen">
      <Heading level={1}>
        {onChain.stockSymbol} {onChain.address.slice(0, 8)}…
      </Heading>

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
              <Button
                testId="repay-and-close"
                disabled={working}
                onClick={() => {
                  void submit.run(`/api/positions/${parameters.id}/repay/build`, {
                    andClose: true,
                  });
                }}
              >
                {working ? ACTION_COPY.repaying : POSITION_COPY.repayAndClose}
              </Button>
            </div>
          </Stack>
        </Banner>
      ) : null}

      {onChain.oraclePriceIsTooOld ? (
        <Banner tone="caution" testId="stale-price-banner">
          {`${FAILURE_COPY.priceTooOld} ${FAILURE_DETAILS.priceAge(
            onChain.stockSymbol,
            howLongAgo(onChain.oraclePriceAgeSeconds),
          )}`}
        </Banner>
      ) : null}

      {onChain.healthZone === 'danger' ? (
        <Banner tone="danger" testId="danger-banner">
          {[
            BANNERS.danger(
              percent(onChain.fallToLiquidationBps, 0),
              onChain.stockSymbol,
              percent(onChain.protectLtvBps, 0),
            ),
            whatTheGuardIsDoing(onChain),
            BANNERS.orDoItYourself,
          ].join(' ')}
        </Banner>
      ) : null}
      {onChain.healthZone === 'caution' ? (
        <Banner tone="caution" testId="caution-banner">
          {BANNERS.caution(percent(onChain.fallToLiquidationBps, 0), onChain.stockSymbol)}
        </Banner>
      ) : null}

      <Panel>
        <Stack gap={16}>
          <Heading level={3}>{POSITION_COPY.summaryTitle}</Heading>
          <BigNumber
            label={POSITION_COPY.youPutIn}
            value={`$${money(inDollars(onChain.collateralValueScaled))}`}
            note={`${money(rawToWhole(onChain.collateralRaw, onChain.collateralDecimals), 4)} ${POSITION_COPY.ofTheStock(onChain.stockSymbol)}`}
            testId="holds"
          />
          <BigNumber
            label={POSITION_COPY.youBorrowed}
            value={`${money(debtWhole)} USDC`}
            note={POSITION_COPY.aYear(percent(onChain.borrowRateBps))}
            testId="owes"
          />
          <BigNumber
            label={POSITION_COPY.itBought}
            value={`${money(rawToWhole(onChain.destinationRaw, onChain.destinationDecimals), 4)} ${onChain.destinationSymbol}`}
            note={POSITION_COPY.aYear(percent(onChain.destinationRateBps))}
            testId="holds-destination"
          />
          <BigNumber
            label={POSITION_COPY.priceNow}
            value={`$${money(price)}`}
            note={
              stored?.collateralPriceAtOpen == null
                ? howLongAgo(onChain.oraclePriceAgeSeconds)
                : POSITION_COPY.priceThenAndChange(
                    `$${money(Number(stored.collateralPriceAtOpen))}`,
                    percentChange(Number(stored.collateralPriceAtOpen), price),
                  )
            }
            testId="stock-price"
          />
          <BigNumber
            label={POSITION_COPY.earningAtNet}
            value={POSITION_COPY.aYear(percent(onChain.netYieldBps))}
            note={POSITION_COPY.loanToValueNow(
              percent(onChain.loanToValueBps, 0),
              percent(onChain.targetLtvBps, 0),
            )}
            testId="net-rate"
          />
        </Stack>
      </Panel>

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
          <Muted testId="price-line">
            {POSITION_LABELS.price(
              money(price),
              howLongAgo(onChain.oraclePriceAgeSeconds),
            )}
          </Muted>
        </Stack>
      </Panel>

      <GuardCard
        status={onChain.healthZone}
        repaysAt={POSITION_COPY.repaysAtAndNow(
          percent(onChain.protectLtvBps, 0),
          percent(onChain.loanToValueBps, 0),
        )}
        lastChecked={
          lastCheck === null || sinceTheLastCheckSeconds === null
            ? COMMON.missingValue
            : POSITION_COPY.lastCheckedBy(
                howLongAgo(sinceTheLastCheckSeconds),
                lastCheck.keeper ?? COMMON.missingValue,
              )
        }
        noKeeperSeen={noKeeperSeen}
        whatItDoes={
          onChain.growEnabled
            ? BORROW_MORE_COPY.repaysAndBorrowsMore
            : BORROW_MORE_COPY.repaysOnly
        }
        repaid={
          onChain.protectCount === 0
            ? POSITION_COPY.repaidNever
            : POSITION_COPY.repaidTimes(
                `${onChain.protectCount}`,
                ago(Number(onChain.lastProtectAt)),
              )
        }
        parameters={[
          {
            label: GUARD_PARAMETER_LABELS.target,
            value: percent(onChain.targetLtvBps, 0),
          },
          {
            label: GUARD_PARAMETER_LABELS.guard,
            value: A_LINE_IN_BOTH_UNITS(
              onChain.stockSymbol,
              percent(
                theGuardLine(onChain.targetLtvBps, onChain.protectLtvBps).fallBps,
                0,
              ),
              percent(onChain.protectLtvBps, 0),
            ),
          },
          {
            label: GUARD_PARAMETER_LABELS.liquidationThreshold,
            value: A_LINE_IN_BOTH_UNITS(
              onChain.stockSymbol,
              percent(
                theLiquidationLine(onChain.targetLtvBps, onChain.liquidationThresholdBps)
                  .fallBps,
                0,
              ),
              percent(onChain.liquidationThresholdBps, 0),
            ),
          },
        ]}
        protectNowIsPointless={onChain.loanToValueBps < onChain.protectLtvBps}
        waitingFor={
          secondsUntilTheGuardCanActAgain(onChain) === 0
            ? null
            : POSITION_COPY.guardIsWaitingOutItsInterval(
                howLong(secondsUntilTheGuardCanActAgain(onChain)),
              )
        }
        onProtectNow={() => {
          void submit.run(`/api/positions/${parameters.id}/protect/build`);
        }}
        onChange={() => {
          setGuard({
            target: onChain.targetLtvBps,
            protect: onChain.protectLtvBps,
            grow: onChain.growBelowLtvBps,
            borrowMore: onChain.growEnabled,
          });
          setSheet('guard');
        }}
      />

      {cluster === 'devnet' ? (
        <DevnetMarketBlock
          stockSymbol={onChain.stockSymbol}
          positionAddress={onChain.address}
          onMoved={reload}
        />
      ) : null}

      <Row style={{ justifyContent: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <Button
          testId="deposit-more"
          onClick={() => {
            setAmount('');
            setSheet('top-up');
          }}
        >
          {TOP_UP_COPY.title}
        </Button>
        <Button
          tone="quiet"
          testId="add-collateral"
          onClick={() => {
            setAmount('');
            setSheet('add');
          }}
        >
          {ACTION_COPY.addCollateral}
        </Button>
        <Button
          tone="quiet"
          testId="repay"
          onClick={() => {
            setAmount('');
            setSheet('repay');
          }}
        >
          {ACTION_COPY.repay}
        </Button>
        <Button tone="quiet" testId="unwind" onClick={() => void openClosing()}>
          {ACTION_COPY.close}
        </Button>
      </Row>

      {submit.state === 'failed' ? (
        <Banner tone="caution" testId="action-failure">
          {submit.failure?.sentence ?? ACTION_COPY.failed}
        </Banner>
      ) : null}
      {submit.state === 'idle' || submit.state === 'failed' ? null : (
        <Muted testId="action-state">
          {submit.state === 'confirmed' ? ACTION_COPY.confirmed : ACTION_COPY.pending}
        </Muted>
      )}
      {submit.signature === null ? null : (
        <TransactionLink
          signature={submit.signature}
          cluster={networkName}
          testId="action-signature"
        />
      )}

      <Sheet
        title={ACTION_COPY.close}
        open={sheet === 'close'}
        testId="closing-sheet"
        onClose={closeTheSheet}
      >
        <Stack gap={12}>
          {closingFailure === null ? null : (
            <Banner tone="caution" testId="closing-failure">
              {closingFailure.sentence}
            </Banner>
          )}
          <p style={{ margin: 0, color: 'var(--color-text)' }}>
            {closing?.sentence ?? CLOSING_COPY.shortfallSentence}
          </p>
          {closing?.neededFromTheWalletRaw == null ? (
            <Stack gap={10}>
              <Muted testId="closing-no-price">
                {CLOSING_COPY.noPriceRightNow(onChain.destinationSymbol)}
              </Muted>
              <div>
                <Button
                  tone="quiet"
                  testId="closing-try-again"
                  disabled={sheet === 'close' && closing === null}
                  onClick={() => {
                    void openClosing();
                  }}
                >
                  {closing === null
                    ? CLOSING_COPY.askingForAPrice
                    : CLOSING_COPY.tryAgain}
                </Button>
              </div>
            </Stack>
          ) : (
            <Stack gap={10}>
              <Row style={{ gap: 12, flexWrap: 'wrap' }}>
                <span data-testid="closing-estimate">
                  <NumbersInMono
                    sentence={CLOSING_COPY.youNeedAbout(
                      `$${money(rawToWhole(closing.neededFromTheWalletRaw, onChain.borrowDecimals))}`,
                    )}
                  />
                </span>
                {cluster === 'devnet' ? (
                  <Button
                    tone="quiet"
                    testId="closing-get-test-usdc"
                    disabled={faucet === 'sending'}
                    onClick={() => void askTheFaucetForUsdc()}
                  >
                    {faucet === 'sending'
                      ? TEST_USDC_COPY.getting
                      : faucet === 'sent'
                        ? TEST_USDC_COPY.sent
                        : TEST_USDC_COPY.get}
                  </Button>
                ) : null}
              </Row>
              {faucet === 'failed' ? <Muted>{TEST_USDC_COPY.failed}</Muted> : null}
            </Stack>
          )}
          <Button
            testId="confirm-close"
            disabled={
              working ||
              closingFailure !== null ||
              closing?.neededFromTheWalletRaw == null
            }
            onClick={() => {
              void submit.run(`/api/positions/${parameters.id}/unwind/build`);
            }}
          >
            {working ? ACTION_COPY.closing : ACTION_COPY.confirm}
          </Button>
          <Button
            tone="link"
            onClick={() => {
              setSheet('none');
            }}
          >
            {COMMON.close}
          </Button>
        </Stack>
      </Sheet>

      <Sheet
        title={TOP_UP_COPY.title}
        open={sheet === 'top-up'}
        testId="top-up-amount"
        onClose={closeTheSheet}
      >
        <Stack gap={12}>
          <AmountField
            testId="top-up-amount-field"
            label={ACTION_COPY.amountLabel}
            symbol={onChain.stockSymbol}
            availableLabel={AMOUNT_FIELD_COPY.inYourWallet}
            availableWhole={stockInTheWallet}
            decimals={onChain.collateralDecimals}
            value={amount}
            note={TOP_UP_COPY.note}
            onChange={setAmount}
          />
          <Button
            testId="top-up-continue"
            disabled={
              amount === '' || Number(amount) <= 0 || Number(amount) > stockInTheWallet
            }
            onClick={() => {
              setSheet('top-up-review');
            }}
          >
            {ACTION_COPY.confirm}
          </Button>
          <Button
            tone="link"
            onClick={() => {
              setSheet('none');
            }}
          >
            {COMMON.close}
          </Button>
        </Stack>
      </Sheet>

      <TopUpSheet
        open={sheet === 'top-up-review'}
        positionId={parameters.id}
        collateralAmountRaw={rawFromTypedAmount(amount, onChain.collateralDecimals)}
        onClose={() => {
          setSheet('none');
        }}
        onDone={() => {
          void load();
        }}
      />

      <Sheet
        title={ACTION_COPY.addCollateral}
        open={sheet === 'add'}
        testId="add-collateral-sheet"
        onClose={closeTheSheet}
      >
        <Stack gap={12}>
          <AmountField
            testId="add-collateral-amount"
            label={ACTION_COPY.amountLabel}
            symbol={onChain.stockSymbol}
            availableLabel={AMOUNT_FIELD_COPY.inYourWallet}
            availableWhole={stockInTheWallet}
            decimals={onChain.collateralDecimals}
            value={amount}
            note={
              stockInTheWallet === 0
                ? AMOUNT_SHEET_COPY.noStockToAdd(onChain.stockSymbol)
                : AMOUNT_SHEET_COPY.addCollateralNote(onChain.stockSymbol)
            }
            onChange={setAmount}
          />
          <Button
            testId="confirm-add-collateral"
            disabled={
              working ||
              amount === '' ||
              Number(amount) <= 0 ||
              Number(amount) > stockInTheWallet
            }
            onClick={() => {
              void submit.run(`/api/positions/${parameters.id}/add-collateral/build`, {
                amountRaw: rawFromTypedAmount(amount, onChain.collateralDecimals),
              });
            }}
          >
            {working ? ACTION_COPY.adding : ACTION_COPY.confirm}
          </Button>
          <Button
            tone="link"
            onClick={() => {
              setSheet('none');
            }}
          >
            {COMMON.close}
          </Button>
        </Stack>
      </Sheet>

      <Sheet
        title={ACTION_COPY.repay}
        open={sheet === 'repay'}
        testId="repay-sheet"
        onClose={closeTheSheet}
      >
        <Stack gap={12}>
          <AmountField
            testId="repay-amount"
            label={ACTION_COPY.amountLabel}
            symbol="USDC"
            availableLabel={AMOUNT_SHEET_COPY.youCanRepay}
            availableWhole={theMostThatCanBeRepaid}
            decimals={onChain.borrowDecimals}
            value={amount}
            note={
              debtWhole === 0
                ? AMOUNT_SHEET_COPY.nothingToRepay
                : AMOUNT_SHEET_COPY.repayNote(money(debtWhole), money(usdcInTheWallet))
            }
            onChange={setAmount}
          />
          <Button
            testId="confirm-repay"
            disabled={
              working ||
              amount === '' ||
              Number(amount) <= 0 ||
              Number(amount) > theMostThatCanBeRepaid
            }
            onClick={() => {
              void submit.run(`/api/positions/${parameters.id}/repay/build`, {
                amountRaw: rawFromTypedAmount(amount, onChain.borrowDecimals),
              });
            }}
          >
            {working ? ACTION_COPY.repaying : ACTION_COPY.confirm}
          </Button>
          <Button
            tone="link"
            onClick={() => {
              setSheet('none');
            }}
          >
            {COMMON.close}
          </Button>
        </Stack>
      </Sheet>

      <Sheet
        title={ACTION_COPY.changeGuard}
        open={sheet === 'guard'}
        testId="guard-sheet"
        onClose={closeTheSheet}
      >
        <Stack gap={16}>
          <Slider
            testId="guard-target-slider"
            numberTestId="guard-target"
            label={GUARD_FIELD_COPY.borrowTo}
            value={guard.target}
            min={500}
            max={onChain.liquidationThresholdBps}
            step={100}
            onChange={(value) => {
              setGuard({ ...guard, target: value });
            }}
            readout={percent(guard.target, 0)}
            isDefault={guard.target === onChain.targetLtvBps}
            onReset={() => {
              setGuard({ ...guard, target: onChain.targetLtvBps });
            }}
            note={GUARD_FIELD_COPY.borrowToNote}
          />
          <Slider
            testId="guard-protect-slider"
            numberTestId="guard-protect"
            label={GUARD_FIELD_COPY.guardRepaysAt}
            value={guard.protect}
            min={500}
            max={onChain.liquidationThresholdBps}
            step={100}
            onChange={(value) => {
              setGuard({ ...guard, protect: value });
            }}
            readout={percent(guard.protect, 0)}
            isDefault={guard.protect === onChain.protectLtvBps}
            onReset={() => {
              setGuard({ ...guard, protect: onChain.protectLtvBps });
            }}
            note={GUARD_FIELD_COPY.guardRepaysAtNote}
          />
          <Slider
            testId="guard-grow-slider"
            numberTestId="guard-grow"
            label={GUARD_FIELD_COPY.borrowBackBelow}
            value={guard.grow}
            min={0}
            max={onChain.liquidationThresholdBps}
            step={100}
            onChange={(value) => {
              setGuard({ ...guard, grow: value });
            }}
            readout={percent(guard.grow, 0)}
            isDefault={guard.grow === onChain.growBelowLtvBps}
            onReset={() => {
              setGuard({ ...guard, grow: onChain.growBelowLtvBps });
            }}
            note={GUARD_FIELD_COPY.borrowBackBelowNote}
          />
          <Row style={{ alignItems: 'flex-start', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <Toggle
                testId="guard-borrow-more"
                label={BORROW_MORE_COPY.label}
                note={BORROW_MORE_COPY.note}
                checked={guard.borrowMore}
                isDefault={!guard.borrowMore}
                onChange={(value) => {
                  setGuard({ ...guard, borrowMore: value });
                }}
              />
            </span>
            <Explainer
              title={BORROW_MORE_COPY.explain}
              testId="guard-borrow-more-explainer"
              lines={borrowMoreLines({
                tokens: rawToWhole(onChain.collateralRaw, onChain.collateralDecimals),
                priceNow: price,
                debtNow: debtWhole,
                targetLtvBps: guard.target,
                liquidationThresholdBps: onChain.liquidationThresholdBps,
                stockSymbol: onChain.stockSymbol,
                destinationSymbol: onChain.destinationSymbol,
              })}
            />
          </Row>
          <Button
            testId="confirm-guard"
            disabled={working}
            onClick={() => {
              void submit.run(`/api/positions/${parameters.id}/strategy/build`, {
                targetLtvBps: guard.target,
                protectLtvBps: guard.protect,
                growBelowLtvBps: guard.grow,
                growEnabled: guard.borrowMore,
                exitOnFlagEnabled: true,
              });
            }}
          >
            {working ? ACTION_COPY.changing : ACTION_COPY.confirm}
          </Button>
          <Button
            tone="link"
            onClick={() => {
              setSheet('none');
            }}
          >
            {COMMON.close}
          </Button>
        </Stack>
      </Sheet>
    </Stack>
  );
}
