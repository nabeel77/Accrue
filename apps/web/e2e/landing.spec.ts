import { LANDING_COPY } from '../src/copy/landing.js';
import { WIDTHS } from './config.js';
import { expect, shoot, test } from './fixtures.js';

test('the landing page shows every section at both widths', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width: width.width, height: width.height });
    await page.goto('/');

    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(page.getByTestId('open-app').first()).toHaveAttribute('href', '/app');
    await expect(page.getByTestId('x-link')).toHaveAttribute('href', LANDING_COPY.xHref);
    await expect(
      page.getByRole('heading', { name: LANDING_COPY.hero.headline }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: LANDING_COPY.howItWorks.title }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: LANDING_COPY.tryTheGuard.title }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: LANDING_COPY.whatItEarns.title }),
    ).toBeVisible();
    await expect(page.getByText(LANDING_COPY.builtOn.eyebrow)).toBeVisible();

    await shoot(page, 'landing', width.name);
  }
});

test('the how it works flow steps through all five', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('flow-counter')).toHaveText('01 / 05');
  await expect(page.getByTestId('flow-sentence')).toHaveText(
    LANDING_COPY.howItWorks.steps[0],
  );

  for (let step = 1; step < LANDING_COPY.howItWorks.steps.length; step += 1) {
    await page.getByTestId('flow-next').click();
    await expect(page.getByTestId('flow-sentence')).toHaveText(
      LANDING_COPY.howItWorks.steps[step] ?? '',
    );
  }
});

test('dragging the guard down makes it repay', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('guard-idle')).toContainText('$151.11');

  await page.getByTestId('guard-range').fill('140');

  await expect(page.getByTestId('guard-chip')).toContainText('$15');
  await expect(page.getByTestId('guard-chip')).toContainText('$92.99');
});
