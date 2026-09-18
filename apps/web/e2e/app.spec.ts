import { appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { screenshotDirectory, WIDTHS } from './config.js';
import { positionOnTheChain } from './chain.js';
import { expect, shoot, test } from './fixtures.js';

const WALLET_NAME = 'Harness wallet';
const STOCK = 'NVDAx';
const DESTINATION = 'ONyc';
const DOLLARS = '40';
const A_MOMENT = 2_000;
const LEGACY_LIMIT_BYTES = 1_232;

const notes = resolve(screenshotDirectory(), 'run.txt');

async function note(line: string): Promise<void> {
  await appendFile(notes, `${line}\n`);
}

test('sign in, open a position and walk every screen at both widths', async ({
  page,
  wallet,
}) => {
  await writeFile(notes, `wallet ${wallet.address}\n`);

  await page.goto('/app');
  await page.getByTestId('gate-sign-in').click();
  await page.getByTestId('wallet-sheet').waitFor({ timeout: 30_000 });
  await note(`screenshot ${await shoot(page, 'wallets', 'desktop')}`);
  await page.getByTestId(`wallet-${WALLET_NAME}`).click();

  const terms = page.getByTestId('terms-gate');
  await expect(terms.or(page.getByTestId('deposit-screen')).first()).toBeVisible({
    timeout: 30_000,
  });
  if (await terms.isVisible()) {
    await note(`screenshot ${await shoot(page, 'terms', 'desktop')}`);
    await page.getByTestId('accept-terms').click();
  }
  await expect(page.getByTestId('deposit-screen')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('faucet').click();
  await expect(page.getByTestId('faucet')).toBeEnabled({ timeout: 60_000 });
  await page.waitForTimeout(A_MOMENT);
  await note(`faucet ${(await page.getByTestId('faucet').innerText()).trim()}`);
  await page.reload();
  await expect(page.getByTestId('deposit-screen')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId(`destination-${DESTINATION}`).click();
  await page.getByTestId(`stock-${STOCK}`).click();
  await page.getByTestId('amount').fill(DOLLARS);

  await page.getByTestId('adjust').click();
  await expect(page.getByTestId('adjust-sheet')).toBeVisible();
  await note(`screenshot ${await shoot(page, 'adjust', 'desktop')}`);
  await page.getByTestId('adjust-done').click();

  await page.getByTestId('deposit').click();
  const acknowledgement = page.getByTestId('acknowledgement');
  await expect(acknowledgement.or(page.getByTestId('review-sheet')).first()).toBeVisible({
    timeout: 60_000,
  });
  if (await acknowledgement.isVisible()) {
    await note(`screenshot ${await shoot(page, 'acknowledgement', 'desktop')}`);
    await page.getByTestId('acknowledge').click();
  }

  await expect(page.getByTestId('review-sheet')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('review-sign')).toBeEnabled({ timeout: 60_000 });
  await note(`screenshot ${await shoot(page, 'review', 'desktop')}`);

  const size = (await page.getByTestId('review-size').innerText()).trim();
  await note(`open compiled to ${size}`);
  const bytes = Number(/^(\d+)/u.exec(size)?.[1] ?? '0');
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThanOrEqual(LEGACY_LIMIT_BYTES);
  expect(size.includes('then')).toBe(false);

  await page.getByTestId('review-sign').click();
  const signature = page.getByTestId('open-signature');
  await expect(signature).toBeVisible({ timeout: 90_000 });
  await note(`open ${(await signature.innerText()).trim()}`);
  await note(`screenshot ${await shoot(page, 'signed', 'desktop')}`);

  await page.goto('/app/portfolio');
  const first = page.locator('[data-testid^="position-"]').first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  const href = await first.getAttribute('href');
  await note(`position ${href ?? 'none'}`);

  const screens: readonly { path: string; name: string; waitFor: string }[] = [
    { path: '/app', name: 'deposit', waitFor: 'deposit-screen' },
    { path: '/app/portfolio', name: 'portfolio', waitFor: 'portfolio-screen' },
    { path: href ?? '/app/portfolio', name: 'position', waitFor: 'position-screen' },
    { path: '/app/activity', name: 'activity', waitFor: 'activity-screen' },
    { path: '/app/about', name: 'about', waitFor: 'about-screen' },
    { path: '/app/kit', name: 'kit', waitFor: 'component-gallery' },
  ];

  for (const width of WIDTHS) {
    await page.setViewportSize({ width: width.width, height: width.height });
    for (const screen of screens) {
      await page.goto(screen.path);
      await expect(page.getByTestId(screen.waitFor)).toBeVisible({ timeout: 60_000 });
      await note(`screenshot ${await shoot(page, screen.name, width.name)}`);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(href ?? '/app/portfolio');
  await expect(page.getByTestId('position-screen')).toBeVisible({ timeout: 60_000 });
});

test('acting on the position it left standing', async ({ page, wallet }) => {
  expect(wallet.address.length).toBeGreaterThan(0);
  await page.goto('/app');
  await page.getByTestId('gate-sign-in').click();
  await page.getByTestId('wallet-sheet').waitFor({ timeout: 30_000 });
  await page.getByTestId(`wallet-${WALLET_NAME}`).click();
  await expect(page.getByTestId('deposit-screen')).toBeVisible({ timeout: 30_000 });

  await page.goto('/app/portfolio');
  const first = page.locator('[data-testid^="position-"]').first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  await page.goto((await first.getAttribute('href')) ?? '/app/portfolio');
  await expect(page.getByTestId('position-screen')).toBeVisible({ timeout: 60_000 });

  // Moved under where the position already sits, so Protect now has something to do.
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/strategy/build')) {
      asked.push(request.postData() ?? '');
    }
  });

  await runAnAction(page, 'guard', async () => {
    await page.getByTestId('guard-details').click();
    await page.getByTestId('guard-change').click();
    await expect(page.getByTestId('guard-sheet')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('guard-target').fill('30');
    await page.getByTestId('guard-protect').fill('35');
    await page.getByTestId('guard-grow').fill('20');
    await page.getByTestId('confirm-guard').click();
  });

  expect(asked.join(' ')).toContain('"targetLtvBps":3000');
  expect(asked.join(' ')).toContain('"protectLtvBps":3500');
  expect(asked.join(' ')).toContain('"growBelowLtvBps":2000');

  await expect
    .poll(
      async () => {
        const read = await positionOnTheChain(wallet.address);
        return `${read?.strategy.targetLtvBps ?? 0}/${read?.strategy.protectLtvBps ?? 0}`;
      },
      { timeout: 60_000 },
    )
    .toBe('3000/3500');
  await note('the chain reads back 3000/3500');

  await runAnAction(page, 'add-collateral', async () => {
    await page.getByTestId('add-collateral').click();
    await expect(page.getByTestId('add-collateral-sheet')).toBeVisible();
    await page.getByTestId('add-collateral-amount').fill('0.01');
    await page.getByTestId('confirm-add-collateral').click();
  });

  await expect(page.getByTestId('guard-protect-now')).toBeEnabled({ timeout: 30_000 });
  await runAnAction(page, 'protect', async () => {
    await page.getByTestId('guard-protect-now').click();
  });

  await page.getByTestId('unwind').click();
  await expect(page.getByTestId('closing-sheet')).toBeVisible({ timeout: 60_000 });
  await note(`screenshot ${await shoot(page, 'closing-sheet', 'desktop')}`);

  await runAnAction(page, 'close', async () => {
    await page.getByTestId('confirm-close').click();
  });
});

async function runAnAction(
  page: Parameters<typeof shoot>[0],
  name: string,
  act: () => Promise<void>,
): Promise<void> {
  const signature = page.getByTestId('action-signature');
  const before = (await signature.count()) === 0 ? '' : await signature.innerText();
  try {
    await act();
    await expect
      .poll(
        async () => ((await signature.count()) === 0 ? '' : await signature.innerText()),
        {
          timeout: 100_000,
        },
      )
      .not.toBe(before);
    await note(`${name} ${(await signature.innerText()).trim()}`);
  } catch {
    let why = '';
    try {
      const said = page.getByTestId('action-state');
      why = (await said.count()) === 0 ? '' : (await said.innerText()).trim();
    } catch {
      why = 'the page was gone by then';
    }
    await note(`${name} did not land${why === '' ? '' : `: ${why}`}`);
  }
}
