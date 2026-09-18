import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { LANDING_COPY } from '../src/copy/landing.js';
import { screenshotDirectory, WIDTHS } from './config.js';
import { expect, shoot, test } from './fixtures.js';

const notes = resolve(screenshotDirectory(), 'run.txt');
const SETTLE_MILLISECONDS = 1_500;

// The progress values marked in the design's frame sheet.
const FRAMES = [
  { progress: 0, name: 'hero' },
  { progress: 0.06, name: 'hero-lift' },
  { progress: 0.16, name: 'beat-02-keep' },
  { progress: 0.28, name: 'beat-03-borrow' },
  { progress: 0.36, name: 'beat-03-dial-settled' },
  { progress: 0.45, name: 'beat-04-earn' },
  { progress: 0.57, name: 'beat-05-guard-dip' },
  { progress: 0.61, name: 'beat-05-guard-tick' },
  { progress: 0.76, name: 'beat-06-leave' },
  { progress: 0.97, name: 'close' },
] as const;

async function scrollToProgress(page: Page, progress: number): Promise<void> {
  await page.evaluate((target) => {
    const span = document.body.scrollHeight - window.innerHeight;
    window.scrollTo({ top: span * target, behavior: 'instant' });
  }, progress);
  await page.waitForTimeout(SETTLE_MILLISECONDS);
}

test('the landing page holds every marked frame at both widths', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width: width.width, height: width.height });
    await page.goto('/');
    await expect(page.getByTestId('open-app-header')).toBeVisible();
    await expect(page.getByTestId('open-app-header')).toHaveAttribute('href', '/app');

    for (const frame of FRAMES) {
      await scrollToProgress(page, frame.progress);
      const file = await shoot(page, `landing-${frame.name}`, width.name, false);
      await appendFile(
        notes,
        `screenshot ${file} at progress ${frame.progress.toFixed(2)}\n`,
      );
    }

    await scrollToProgress(page, 1);
    await expect(page.getByTestId('open-app-close')).toHaveAttribute('href', '/app');
  }
});

test('the guard tick fires in the falling stock moment', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await scrollToProgress(page, 0.55);
  const beforeTheTick = await page.locator('[data-tick]').getAttribute('r');
  const loanBeforeTheTick = await page.locator('[data-loan-text]').innerText();
  const liquidationBefore = await page.locator('[data-liq]').getAttribute('y1');

  await scrollToProgress(page, 0.65);
  const afterTheTick = await page.locator('[data-tick]').getAttribute('r');
  const loanAfterTheTick = await page.locator('[data-loan-text]').innerText();
  const liquidationAfter = await page.locator('[data-liq]').getAttribute('y1');

  expect(Number(beforeTheTick)).toBe(0);
  expect(Number(afterTheTick)).toBeGreaterThan(0);
  expect(loanBeforeTheTick).toBe('$400.00');
  expect(loanAfterTheTick).toBe('$300.00');
  // The liquidation line moves down the chart, which is a larger y.
  expect(Number(liquidationAfter)).toBeGreaterThan(Number(liquidationBefore));
  await expect(page.locator('[data-guard-tag]')).toHaveText(LANDING_COPY.guard.tag);
});

test('a reader who asked for less motion gets the whole page at once', async ({
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForTimeout(SETTLE_MILLISECONDS);

  for (const beat of LANDING_COPY.beats) {
    await expect(page.getByText(beat.heading, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('open-app-close')).toBeVisible();
  const file = await shoot(page, 'landing-reduced-motion', 'desktop');
  await appendFile(notes, `screenshot ${file}\n`);
  await context.close();
});
