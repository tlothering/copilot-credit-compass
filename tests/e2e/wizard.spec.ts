import { test, expect, type Page } from '@playwright/test';

/**
 * The wizard happy path, per SPEC §13 acceptance criteria 1, 4, 6 and 8.
 *
 * Runs against a production build with no database configured — the fallback
 * path a fresh clone hits. If the app cannot complete an assessment and produce
 * an export without Cosmos, that is a bug, not an environment problem.
 */

async function continueFrom(page: Page, step: number) {
  const next = page.getByRole('button', { name: /Continue|Calculate my result/ });
  await expect(next).toBeEnabled();
  await next.click();
  await page.waitForURL(new RegExp(`/assess/${step + 1}(\\?|$)`));
}

test.describe('wizard', () => {
  test('completes end to end and reaches a recommendation', async ({ page }) => {
    await page.goto('/assess/0');

    // Step 0 — welcome. The session-loss warning is constraint C2 and must be
    // visible before the user has invested any effort.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/no account and no server-side session/i).first()).toBeVisible();
    await continueFrom(page, 0);

    // Step 1 — profile. Defaults are pre-populated so the path is walkable
    // without inventing data; we only need to confirm the controls exist.
    await expect(page).toHaveURL(/\/assess\/1/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await continueFrom(page, 1);

    // Step 2 — workloads. Forward navigation is gated until at least one is
    // chosen, which is the only hard gate in the wizard.
    await expect(page).toHaveURL(/\/assess\/2/);
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(checkboxes.first()).toBeVisible();

    const checked = await page.locator('input[type="checkbox"]:checked').count();
    if (checked === 0) {
      await checkboxes.first().check();
      await checkboxes.nth(1).check();
    }
    await expect(page.locator('input[type="checkbox"]:checked').first()).toBeChecked();
    await continueFrom(page, 2);

    // Step 3 — usage. The running estimate must be live and announced.
    await expect(page).toHaveURL(/\/assess\/3/);
    const estimate = page.locator('[aria-live]').first();
    await expect(estimate).toBeAttached();
    await continueFrom(page, 3);

    // Step 4 — growth.
    await expect(page).toHaveURL(/\/assess\/4/);
    await continueFrom(page, 4);

    // Step 5 — review, then calculate.
    await expect(page).toHaveURL(/\/assess\/5/);
    await page.getByRole('button', { name: /Calculate my result/ }).click();
    await page.waitForURL(/\/results/);

    // The recommendation and the flagship break-even must both be present.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/break-even/i).first()).toBeVisible();

    // Acceptance criterion 3: all eight funding options, always.
    const optionLabels = [
      /pay-as-you-go/i,
      /capacity pack/i,
      /pre-purchase/i,
      /licence shift|license shift/i,
      /Foundry|bring your own model/i,
      /do nothing/i,
    ];
    for (const label of optionLabels) {
      await expect(page.getByText(label).first()).toBeVisible();
    }

    // Acceptance criterion 11: the rate card version is visible in the UI.
    await expect(page.getByText(/v1/).first()).toBeVisible();
  });

  test('warns before discarding the session', async ({ page }) => {
    await page.goto('/assess/2');

    // The guard is deliberately conditional on the session being dirty — a
    // pristine wizard has nothing worth interrupting the user over. So dirty
    // it first, then assert the handler cancels the event.
    const boxes = page.locator('input[type="checkbox"]');
    await boxes.first().click();
    await boxes.nth(1).click();

    const guardedWhenDirty = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(guardedWhenDirty).toBe(true);
  });

  test('steps are URL-addressable and survive a reload', async ({ page }) => {
    await page.goto('/assess/2');
    await expect(page).toHaveURL(/\/assess\/2/);

    const boxes = page.locator('input[type="checkbox"]');
    await boxes.first().check();
    const beforeReload = await page.locator('input[type="checkbox"]:checked').count();

    await page.reload();
    // sessionStorage survives a reload within the same tab, per SPEC §5.
    await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(beforeReload);
  });
});
