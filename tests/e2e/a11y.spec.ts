import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

/**
 * SPEC §13 acceptance criterion 10: zero axe-core violations on every route.
 *
 * Accessibility here is not a checkbox. The whole premise of the tool is that
 * a finance or IT leader can interrogate the numbers; someone using a screen
 * reader must be able to interrogate them equally well. That is why charts
 * carry real tables and the running estimate is announced.
 */

const ROUTES = ['/', '/assess/0', '/assess/2', '/benchmark', '/methodology', '/privacy'];

const STANDARDS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const route of ROUTES) {
  test(`${route} has no axe violations`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();

    if (results.violations.length > 0) {
      console.error(
        JSON.stringify(
          results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.map((n) => n.html.slice(0, 200)),
          })),
          null,
          2,
        ),
      );
    }

    expect(results.violations).toEqual([]);
  });
}

// The design is dark-first but the headless browser reports a light preference,
// so the light theme is what the loop above actually exercised. Both themes ship,
// so both are tested.
for (const route of ROUTES) {
  test(`${route} has no axe violations in dark mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(route);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
    if (results.violations.length > 0) {
      console.error(
        JSON.stringify(
          results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              html: n.html.slice(0, 200),
              summary: n.failureSummary,
            })),
          })),
          null,
          2,
        ),
      );
    }
    expect(results.violations).toEqual([]);
  });
}

test('/results has no axe violations', async ({ page }) => {
  await page.goto('/assess/0');
  for (let i = 0; i < 5; i++) {
    const next = page.getByRole('button', { name: /Continue|Calculate my result/ });
    await expect(next).toBeEnabled();
    await next.click();
    await page.waitForURL(new RegExp(`/assess/${i + 1}(\\?|$)`));
    if (i === 1) {
      const boxes = page.locator('input[type="checkbox"]');
      if ((await page.locator('input[type="checkbox"]:checked').count()) === 0) {
        await boxes.first().check();
        await boxes.nth(1).check();
      }
    }
  }
  await page.getByRole('button', { name: /Calculate my result/ }).click();
  await page.waitForURL(/\/results/);
  await page.waitForLoadState('networkidle');

  const results = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
  if (results.violations.length > 0) {
    console.error(JSON.stringify(results.violations, null, 2));
  }
  expect(results.violations).toEqual([]);
});

test('the wizard is fully keyboard navigable', async ({ page }) => {
  await page.goto('/assess/0');

  // Tab until the Continue button takes focus. If it cannot be reached by
  // keyboard within a reasonable number of stops, the page has a trap.
  let reached = false;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (/Continue/.test(label)) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);

  await page.keyboard.press('Enter');
  await page.waitForURL(/\/assess\/1/);
});

test('charts expose their data as real tables', async ({ page }) => {
  await page.goto('/assess/0');
  for (let i = 0; i < 5; i++) {
    const next = page.getByRole('button', { name: /Continue|Calculate my result/ });
    await next.click();
    await page.waitForURL(new RegExp(`/assess/${i + 1}(\\?|$)`));
    if (i === 1) {
      const boxes = page.locator('input[type="checkbox"]');
      if ((await page.locator('input[type="checkbox"]:checked').count()) === 0) {
        await boxes.first().check();
      }
    }
  }
  await page.getByRole('button', { name: /Calculate my result/ }).click();
  await page.waitForURL(/\/results/);

  // Every chart frame renders a table with a caption; the visual is aria-hidden.
  const tables = page.locator('table');
  expect(await tables.count()).toBeGreaterThan(0);
});
