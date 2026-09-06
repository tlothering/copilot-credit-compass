import { expect, test } from '@playwright/test';

/**
 * Regression cover for a defect the rest of the suite sailed straight past.
 *
 * The landing benchmark ticker read `/api/benchmark/summary` through a
 * hand-written local interface that had drifted from the real response. Because
 * `as Promise<T>` asserts a shape rather than checking one, TypeScript had
 * nothing to compare against and every tile rendered an em dash — in both
 * themes, on every visit. The wizard, export and axe suites all stayed green
 * throughout, because a page full of em dashes is perfectly accessible.
 *
 * These assertions are deliberately about *rendered values*, not markup. Any
 * future drift between the aggregator and a consumer shows up here.
 */

const TICKER_LABELS = [
  'Assessments contributed',
  'Published cohorts',
  'Median credits / user / month',
  'Most recommended strategy',
];

test.describe('landing benchmark ticker', () => {
  test('renders a real figure for every tile', async ({ page }) => {
    await page.goto('/');

    const ticker = page.locator('dl').filter({ hasText: TICKER_LABELS[0] }).first();
    await expect(ticker).toBeVisible();

    for (const label of TICKER_LABELS) {
      const value = ticker.locator('div.card').filter({ hasText: label }).locator('dd');
      await expect(value, `tile "${label}" should resolve`).toBeVisible();

      // Never still loading, and never the em dash that num() emits for a
      // non-finite value — which is exactly what a mis-typed field produces.
      await expect(value.locator('.skeleton')).toHaveCount(0);
      await expect(value).not.toHaveText('—');
      await expect(value).not.toBeEmpty();
    }
  });

  test('the assessment count is a number, not a placeholder', async ({ page }) => {
    await page.goto('/');

    const ticker = page.locator('dl').filter({ hasText: TICKER_LABELS[0] }).first();
    const count = ticker.locator('div.card').filter({ hasText: TICKER_LABELS[0] }).locator('dd');

    // headline.assessments is always present and always numeric — it is 0 on a
    // fresh deployment with no contributions — so this holds in CI with an
    // empty store as well as locally with seeded data.
    await expect(count).toHaveText(/^[\d,]+$/);
  });

  test('the ticker degrades quietly when the aggregate is unavailable', async ({ page }) => {
    await page.route('**/api/benchmark/summary', (route) => route.fulfill({ status: 500, body: '{}' }));
    await page.goto('/');

    // The block is decorative: a failed aggregate must remove it, never break
    // the page or leave skeletons spinning forever.
    await expect(page.locator('dl').filter({ hasText: TICKER_LABELS[0] })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
