'use client';

import type { JSX } from 'react';

import {
  Button,
  Heading,
  Muted,
  Secondary,
  Sheet,
  Stack,
} from '../../components/ui/index.js';
import { COMMON } from '../../copy/common.js';
import { YIELD_TOKEN_DETAILS_COPY } from '../../copy/deposit.js';
import { howLongAgo, money, percent, rawToWhole } from '../../client/format.js';

const USDC_DECIMALS = 6;
const A_SECOND = 1_000;

export interface YieldTokenExit {
  readonly sellableTodayUsdcRaw: string;
  readonly slippageBps: number;
  readonly quotedAtMilliseconds: number;
}

export type PriceSource = 'jupiter' | 'test-router';

export function YieldTokenDetailsSheet({
  open,
  destinationSymbol,
  targetRateBps,
  targetRateSource,
  targetRateReadAtMilliseconds,
  exit,
  priceSource,
  onClose,
}: {
  open: boolean;
  destinationSymbol: string;
  targetRateBps: number;
  targetRateSource: string;
  targetRateReadAtMilliseconds: number | null;
  exit: YieldTokenExit | null;
  priceSource: PriceSource;
  onClose: () => void;
}): JSX.Element {
  const priceSourceName =
    priceSource === 'test-router'
      ? YIELD_TOKEN_DETAILS_COPY.testRouter
      : YIELD_TOKEN_DETAILS_COPY.jupiter;

  return (
    <Sheet
      title={YIELD_TOKEN_DETAILS_COPY.title}
      open={open}
      testId={`yield-token-details-${destinationSymbol}`}
      onClose={onClose}
    >
      <Stack gap={16}>
        <Stack gap={6}>
          <Secondary testId="details-pays">
            {YIELD_TOKEN_DETAILS_COPY.paysAbout(
              destinationSymbol,
              percent(targetRateBps),
            )}
          </Secondary>
          <Muted>
            {targetRateReadAtMilliseconds === null
              ? YIELD_TOKEN_DETAILS_COPY.whatTheIssuerAimsForUnread
              : YIELD_TOKEN_DETAILS_COPY.whatTheIssuerAimsFor(
                  howLongAgo((Date.now() - targetRateReadAtMilliseconds) / A_SECOND),
                )}
          </Muted>
        </Stack>

        <Stack gap={6}>
          <Heading level={3}>{YIELD_TOKEN_DETAILS_COPY.sellingItBackTitle}</Heading>
          {exit === null ? (
            <Muted testId="details-selling-back">
              {YIELD_TOKEN_DETAILS_COPY.noPriceToSellAt(destinationSymbol)}
            </Muted>
          ) : (
            <>
              <Muted testId="details-selling-back">
                {YIELD_TOKEN_DETAILS_COPY.sellUpTo(
                  `$${money(rawToWhole(exit.sellableTodayUsdcRaw, USDC_DECIMALS), 0)}`,
                  destinationSymbol,
                  percent(exit.slippageBps, 1),
                  howLongAgo((Date.now() - exit.quotedAtMilliseconds) / A_SECOND),
                )}
              </Muted>
              <Muted>{YIELD_TOKEN_DETAILS_COPY.askTheIssuer}</Muted>
            </>
          )}
        </Stack>

        <Stack gap={6}>
          <Heading level={3}>
            {YIELD_TOKEN_DETAILS_COPY.whereTheNumbersComeFromTitle}
          </Heading>
          <Muted testId="details-sources">
            {YIELD_TOKEN_DETAILS_COPY.sources(targetRateSource, priceSourceName)}
          </Muted>
        </Stack>

        <Button tone="link" onClick={onClose}>
          {COMMON.close}
        </Button>
      </Stack>
    </Sheet>
  );
}
