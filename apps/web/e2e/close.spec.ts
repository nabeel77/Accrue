import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { screenshotDirectory } from './config.js';
import { expect, test } from './fixtures.js';

const WALLET_NAME = 'Harness wallet';
const notes = resolve(screenshotDirectory(), 'run.txt');

test('closing a position from the page', async ({ page, wallet }) => {
  expect(wallet.address.length).toBeGreaterThan(0);
  page.on('pageerror', (entry) => {
    void appendFile(notes, `page error: ${entry.message}\n`);
  });
  page.on('console', (entry) => {
    if (entry.type() === 'error') {
      void appendFile(notes, `page said: ${entry.text().slice(0, 300)}\n`);
    }
  });

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

  await page.getByTestId('unwind').click();
  await expect(page.getByTestId('closing-sheet')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('confirm-close').click();

  const signature = page.getByTestId('action-signature');
  try {
    await expect(signature).toBeVisible({ timeout: 150_000 });
    await appendFile(notes, `close ${(await signature.innerText()).trim()}\n`);
  } catch (failure) {
    const state = page.getByTestId('action-state');
    const said =
      (await state.count()) === 0 ? 'nothing' : (await state.innerText()).trim();
    await appendFile(notes, `close did not land: ${said}\n`);
    throw failure;
  }
});
