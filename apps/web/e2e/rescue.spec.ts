import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RESCUE_COPY } from '../../rescue/src/copy.js';
import { RESCUE_URL, screenshotDirectory, WEB_URL, WIDTHS } from './config.js';
import { expect, shoot, test } from './fixtures.js';
import { itStillAnswers, stopIt } from './servers.js';

const notes = resolve(screenshotDirectory(), 'run.txt');
const A_MOMENT = 3_000;

test('the web app stops and the static page still hands everything back', async ({
  page,
  wallet,
}) => {
  stopIt(Number(process.env['E2E_WEB_PID']) || undefined);
  await page.waitForTimeout(A_MOMENT);
  expect(await itStillAnswers(`${WEB_URL}/api/me`)).toBe(false);
  await appendFile(notes, `the web app is stopped, rescuing as ${wallet.address}\n`);

  await page.goto(RESCUE_URL);
  await expect(page.getByTestId('connect')).toBeVisible();
  await expect(page.getByTestId('cluster')).toHaveValue('devnet');

  const endpoint = process.env['HELIUS_RPC_URL'];
  if (endpoint !== undefined && endpoint !== '') {
    await page.getByTestId('endpoint').fill(endpoint);
  }

  for (const width of WIDTHS) {
    await page.setViewportSize({ width: width.width, height: width.height });
    await appendFile(notes, `screenshot ${await shoot(page, 'rescue', width.name)}\n`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('connect').click();

  const first = page.locator('[data-testid^="position-"]').first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  await first.getByTestId('rescue').click();

  const signature = page.getByTestId('rescue-signature');
  try {
    await expect(signature).toBeVisible({ timeout: 120_000 });
  } catch (failure) {
    const said = await first.getByTestId('rescue-state').innerText();
    await appendFile(notes, `rescue did not land: ${said.trim()}\n`);
    throw failure;
  }
  const shown = await signature.getAttribute('title');
  await appendFile(notes, `rescue ${shown ?? (await signature.innerText()).trim()}\n`);

  const state = first.getByTestId('rescue-state');
  try {
    await expect(state).toHaveText(RESCUE_COPY.done, { timeout: 120_000 });
  } catch (failure) {
    await appendFile(
      notes,
      `rescue did not finish: ${(await state.innerText()).trim()}\n`,
    );
    throw failure;
  }
  await appendFile(
    notes,
    'the position is closed and the wallet holds nothing of ours\n',
  );
  await appendFile(notes, `screenshot ${await shoot(page, 'rescue-done', 'desktop')}\n`);
});
