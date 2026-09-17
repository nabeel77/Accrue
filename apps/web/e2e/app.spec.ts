import { appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { screenshotDirectory, WIDTHS } from './config.js';
import { expect, shoot, test } from './fixtures.js';

const STOCK = 'NVDAx';
const DESTINATION = 'ONyc';
const DOLLARS = '40';
const A_MOMENT = 2_000;

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
  await page.getByTestId('unwind').click();
  await expect(page.getByTestId('closing-sheet')).toBeVisible({ timeout: 60_000 });
  await note(`screenshot ${await shoot(page, 'closing-sheet', 'desktop')}`);
});
