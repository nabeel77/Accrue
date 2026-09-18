import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import {
  CURRENT_RISK_ACKNOWLEDGEMENT_VERSION,
  CURRENT_TERMS_VERSION,
} from '@accrue/core';

import { FAILURE_COPY } from '../src/copy/errors.js';
import { screenshotDirectory } from './config.js';
import { setTheStoredVersions } from './database.js';
import { expect, shoot, test } from './fixtures.js';

const WALLET_NAME = 'Harness wallet';
const STOCK = 'NVDAx';
const DESTINATION = 'ONyc';
const A_SMALL_DEPOSIT = '20';
const MORE_THAN_THE_WALLET_HOLDS = '5000';
const BUILDS_ALLOWED_IN_A_MINUTE = 6;

const notes = resolve(screenshotDirectory(), 'errors.txt');

async function note(line: string): Promise<void> {
  await appendFile(notes, `${line}\n`);
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/app');
  await page.getByTestId('gate-sign-in').click();
  await page.getByTestId('wallet-sheet').waitFor({ timeout: 30_000 });
  await page.getByTestId(`wallet-${WALLET_NAME}`).click();
  const terms = page.getByTestId('terms-gate');
  await expect(terms.or(page.getByTestId('deposit-screen')).first()).toBeVisible({
    timeout: 30_000,
  });
  if (await terms.isVisible()) {
    await page.getByTestId('accept-terms').click();
  }
  await expect(page.getByTestId('deposit-screen')).toBeVisible({ timeout: 30_000 });
}

async function fillTheDeposit(page: Page, dollars: string): Promise<void> {
  await page.getByTestId(`destination-${DESTINATION}`).click();
  await page.getByTestId(`stock-${STOCK}`).click();
  await page.getByTestId('amount').fill(dollars);
}

async function openTheReviewSheet(page: Page): Promise<void> {
  await page.getByTestId('deposit').click();
  const acknowledgement = page.getByTestId('acknowledgement');
  await expect(acknowledgement.or(page.getByTestId('review-sheet')).first()).toBeVisible({
    timeout: 60_000,
  });
  if (await acknowledgement.isVisible()) {
    await page.getByTestId('acknowledge').click();
  }
  await expect(page.getByTestId('review-sheet')).toBeVisible({ timeout: 60_000 });
}

async function reportTheFailure(
  page: Page,
  testId: string,
  name: string,
  expected: string,
): Promise<void> {
  const shown = page.getByTestId(testId);
  await expect(shown).toBeVisible({ timeout: 90_000 });
  const said = (await shown.innerText()).trim();
  expect(said).toContain(expected);
  await note(`${name}: ${said}`);
  await note(`screenshot ${await shoot(page, `error-${name}`, 'desktop')}`);
}

test.describe('a wallet pointed at another network', () => {
  test.use({ pretence: { chains: ['solana:mainnet'] } });

  test('gets one line telling it to switch', async ({ page }) => {
    await page.goto('/app');
    await page.getByTestId('gate-sign-in').click();
    await page.getByTestId('wallet-sheet').waitFor({ timeout: 30_000 });
    await page.getByTestId(`wallet-${WALLET_NAME}`).click();
    await reportTheFailure(
      page,
      'wrong-network',
      'wrong-network',
      FAILURE_COPY.wrongNetwork,
    );
  });
});

test.describe('a wallet that refuses to sign', () => {
  test.use({ pretence: { refusesToSign: true } });

  test('leaves the position unbuilt and says so once', async ({ page }) => {
    await signIn(page);
    await fillTheDeposit(page, A_SMALL_DEPOSIT);
    await openTheReviewSheet(page);
    await expect(page.getByTestId('review-sign')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('review-sign').click();
    await reportTheFailure(
      page,
      'review-failure',
      'rejected-signature',
      FAILURE_COPY.signatureRejected,
    );
    await expect(page.getByTestId('open-signature')).toHaveCount(0);
  });
});

test('a deposit larger than the wallet holds never reaches a signature', async ({
  page,
}) => {
  await signIn(page);
  await fillTheDeposit(page, MORE_THAN_THE_WALLET_HOLDS);
  await openTheReviewSheet(page);
  await reportTheFailure(
    page,
    'review-failure',
    'failed-simulation',
    FAILURE_COPY.simulationFailed,
  );
  await expect(page.getByTestId('review-sign')).toBeDisabled();
});

test('a quote held past its life is not signable until it is read again', async ({
  page,
}) => {
  await page.clock.install();
  await signIn(page);
  await fillTheDeposit(page, A_SMALL_DEPOSIT);
  await openTheReviewSheet(page);
  await expect(page.getByTestId('review-sign')).toBeEnabled({ timeout: 60_000 });

  await page.clock.fastForward('02:00');
  await reportTheFailure(page, 'stale-quote', 'stale-quote', FAILURE_COPY.staleQuote);
  await expect(page.getByTestId('review-sign')).toBeDisabled();
  await expect(page.getByTestId('requote')).toBeVisible();
});

test('a chain read that never answers says nothing was sent', async ({ page }) => {
  await signIn(page);
  await fillTheDeposit(page, A_SMALL_DEPOSIT);
  // The route answers what a build that ran out its forty seconds answers.
  await page.route('**/api/positions/build', async (route) => {
    await route.fulfill({
      status: 504,
      contentType: 'application/json',
      body: JSON.stringify({ failure: 'rpcTimeout' }),
    });
  });
  await openTheReviewSheet(page);
  await reportTheFailure(page, 'review-failure', 'rpc-timeout', FAILURE_COPY.rpcTimeout);
});

test('a wallet whose accepted terms are behind is told to read them again', async ({
  page,
  wallet,
}) => {
  await signIn(page);
  await fillTheDeposit(page, A_SMALL_DEPOSIT);
  await setTheStoredVersions(wallet.address, { terms: CURRENT_TERMS_VERSION - 1 });
  try {
    await openTheReviewSheet(page);
    await reportTheFailure(
      page,
      'review-failure',
      'terms-behind',
      FAILURE_COPY.termsBehind,
    );
  } finally {
    await setTheStoredVersions(wallet.address, { terms: CURRENT_TERMS_VERSION });
  }
});

test('a wallet whose acknowledgement is behind is told to read it again', async ({
  page,
  wallet,
}) => {
  await signIn(page);
  await fillTheDeposit(page, A_SMALL_DEPOSIT);
  await setTheStoredVersions(wallet.address, {
    acknowledgement: CURRENT_RISK_ACKNOWLEDGEMENT_VERSION - 1,
  });
  try {
    // The sheet comes back first, and the build behind it still refuses on the stored version.
    await page.getByTestId('deposit').click();
    const acknowledgement = page.getByTestId('acknowledgement');
    await expect(acknowledgement).toBeVisible({ timeout: 60_000 });
    await note(
      `screenshot ${await shoot(page, 'error-acknowledgement-behind', 'desktop')}`,
    );

    const answer = await page.request.post('/api/positions/build', {
      data: {
        stockMint: await page.getByTestId(`stock-${STOCK}`).getAttribute('data-mint'),
        destinationSymbol: DESTINATION,
        collateralAmountRaw: '1',
      },
    });
    expect(answer.status()).toBe(403);
    const body = (await answer.json()) as { refusal?: string };
    expect(body.refusal).toBe('acknowledgement');
    await note('acknowledgement behind: the build route refused with 403');
  } finally {
    await setTheStoredVersions(wallet.address, {
      acknowledgement: CURRENT_RISK_ACKNOWLEDGEMENT_VERSION,
    });
  }
});

test('more builds than the minute allows are refused with the wait', async ({ page }) => {
  await signIn(page);
  await fillTheDeposit(page, A_SMALL_DEPOSIT);

  const answers: number[] = [];
  for (let attempt = 0; attempt < BUILDS_ALLOWED_IN_A_MINUTE + 2; attempt += 1) {
    const answer = await page.request.post('/api/positions/build', {
      data: {
        stockMint: await page.getByTestId(`stock-${STOCK}`).getAttribute('data-mint'),
        destinationSymbol: DESTINATION,
        collateralAmountRaw: '1',
      },
    });
    answers.push(answer.status());
  }
  expect(answers).toContain(429);
  await note(`rate limit: the build route answered ${answers.join(' ')}`);

  await openTheReviewSheet(page);
  await reportTheFailure(page, 'review-failure', 'rate-limit', FAILURE_COPY.rateLimited);
});
