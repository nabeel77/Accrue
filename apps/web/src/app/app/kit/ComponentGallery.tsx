'use client';

import { useState, type JSX, type ReactNode } from 'react';

import {
  AmountField,
  Banner,
  Button,
  GuardCard,
  HealthBar,
  Mono,
  Muted,
  Panel,
  Row,
  Secondary,
  Sheet,
  Slider,
  Stack,
  Toggle,
  WalletPill,
} from '@/components/ui';
import { AMOUNT_FIELD_COPY } from '@/copy/common';
import { GUARD_PARAMETER_LABELS } from '@/copy/position';

const AN_EXAMPLE_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

function Case({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <Stack gap={10}>
      <Mono tone="muted" style={{ fontSize: 11, letterSpacing: '0.12em' }}>
        {label.toUpperCase()}
      </Mono>
      {children}
    </Stack>
  );
}

export function ComponentGallery(): JSX.Element {
  const [borrowBps, setBorrowBps] = useState(4_000);
  const [autoGrow, setAutoGrow] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [amount, setAmount] = useState('');

  return (
    <Stack gap={28} testId="component-gallery">
      <Panel>
        <Stack gap={18}>
          <Case label="Button, every tone and disabled">
            <Row style={{ justifyContent: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <Button>Deposit</Button>
              <Button tone="quiet">Adjust</Button>
              <Button tone="link">Reset to default</Button>
              <Button disabled>Deposit</Button>
              <Button tone="quiet" disabled>
                Adjust
              </Button>
            </Row>
          </Case>

          <Case label="Banner, every tone">
            <Stack gap={10}>
              <Banner tone="notice">
                This is devnet. The tokens here are test tokens and have no value.
              </Banner>
              <Banner tone="caution">
                Your position is 18.40 percent from liquidation. Repaying part of the loan
                or adding collateral moves it away.
              </Banner>
              <Banner tone="danger">
                Your position is 4.10 percent from liquidation and above its guard level
                of 50 percent. The last guard action was 3 minutes ago.
              </Banner>
            </Stack>
          </Case>

          <Case label="Health bar, every zone">
            <Stack gap={14}>
              <HealthBar fillBps={3_200} zone="healthy" label="Health" />
              <HealthBar fillBps={6_900} zone="caution" label="Health" />
              <HealthBar fillBps={9_100} zone="danger" label="Health" />
            </Stack>
          </Case>

          <Case label="Wallet pill">
            <Row style={{ justifyContent: 'flex-start' }}>
              <WalletPill address={AN_EXAMPLE_ADDRESS} />
            </Row>
          </Case>

          <Case label="Amount field, with what is available, HALF and MAX">
            <AmountField
              testId="kit-amount"
              label="Amount"
              symbol="USDC"
              availableLabel={AMOUNT_FIELD_COPY.owedNow}
              availableWhole={20}
              decimals={6}
              value={amount}
              note="Type more than the figure on the right to see the field refuse it."
              onChange={setAmount}
            />
          </Case>

          <Case label="Slider, changed and at the default">
            <Stack gap={16}>
              <Slider
                label="Borrow"
                value={borrowBps}
                min={1_000}
                max={6_000}
                step={100}
                onChange={setBorrowBps}
                readout={`${(borrowBps / 100).toFixed(0)}%`}
                isDefault={borrowBps === 4_000}
                onReset={() => {
                  setBorrowBps(4_000);
                }}
                note="Accrue's default for this stock."
                testId="kit-slider"
              />
            </Stack>
          </Case>

          <Case label="Toggle, on and off">
            <Stack gap={12}>
              <Toggle
                label="Borrow back up when the stock recovers"
                note="The guard borrows back to target and buys more of the yield token."
                checked={autoGrow}
                onChange={setAutoGrow}
                testId="kit-toggle"
              />
            </Stack>
          </Case>

          <Case label="Sheet">
            <Row style={{ justifyContent: 'flex-start' }}>
              <Button
                tone="quiet"
                testId="kit-open-sheet"
                onClick={() => {
                  setSheetOpen(true);
                }}
              >
                Open the sheet
              </Button>
            </Row>
            <Sheet
              title="A sheet"
              open={sheetOpen}
              testId="kit-sheet"
              onClose={() => {
                setSheetOpen(false);
              }}
            >
              <Stack gap={12}>
                <Secondary>
                  Our own sheet. The app never calls the browser&apos;s alert, confirm or
                  prompt.
                </Secondary>
                <Button
                  tone="link"
                  onClick={() => {
                    setSheetOpen(false);
                  }}
                >
                  Close
                </Button>
              </Stack>
            </Sheet>
          </Case>

          <Case label="Text, every tone">
            <Stack gap={6}>
              <Secondary>Secondary text sits under a heading.</Secondary>
              <Muted>Muted text is for labels and sources.</Muted>
              <Row style={{ justifyContent: 'flex-start', gap: 14 }}>
                <Mono>1,240.00</Mono>
                <Mono tone="gold">8.42%</Mono>
                <Mono tone="accent">Healthy</Mono>
                <Mono tone="secondary">2 minutes ago</Mono>
                <Mono tone="muted">—</Mono>
              </Row>
            </Stack>
          </Case>
        </Stack>
      </Panel>

      <Stack gap={16}>
        <Case label="Guard card, every status">
          <Stack gap={16}>
            <GuardCard
              status="healthy"
              repaysAt="50% LTV · now 40%"
              lastChecked="12 seconds ago · 4f3a…9b2c"
              noKeeperSeen={null}
              repaid="not yet"
              whatItDoes="Repays only"
              parameters={[
                { label: GUARD_PARAMETER_LABELS.target, value: '40%' },
                { label: GUARD_PARAMETER_LABELS.guard, value: '50%' },
                { label: GUARD_PARAMETER_LABELS.liquidationThreshold, value: '60%' },
              ]}
            />
            <GuardCard
              status="caution"
              repaysAt="50% LTV · now 48%"
              lastChecked="14 minutes ago · 4f3a…9b2c"
              noKeeperSeen="No keeper seen for 14 min"
              repaid="2 times · last 25 seconds ago"
              whatItDoes="Repays and borrows more"
              waitingFor="The guard repays this position at most once a minute, so its next turn is in 40 seconds. You can repay it yourself now, and so can anyone once the market could seize it."
              parameters={[
                { label: GUARD_PARAMETER_LABELS.target, value: '40%' },
                { label: GUARD_PARAMETER_LABELS.guard, value: '50%' },
                { label: GUARD_PARAMETER_LABELS.liquidationThreshold, value: '60%' },
              ]}
              onChange={() => undefined}
            />
            <GuardCard
              status="danger"
              repaysAt="50% LTV · now 57%"
              lastChecked="2 minutes ago · 4f3a…9b2c"
              noKeeperSeen={null}
              repaid="not yet"
              whatItDoes="Repays only"
              parameters={[
                { label: GUARD_PARAMETER_LABELS.target, value: '40%' },
                { label: GUARD_PARAMETER_LABELS.guard, value: '50%' },
                { label: GUARD_PARAMETER_LABELS.liquidationThreshold, value: '60%' },
              ]}
              onProtectNow={() => undefined}
              onChange={() => undefined}
            />
          </Stack>
        </Case>
      </Stack>
    </Stack>
  );
}
