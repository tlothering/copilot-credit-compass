import { expect, test } from '@playwright/test';

/**
 * The region picker moved off Microsoft field/area names (NA, LATAM, UK&I, CEE,
 * MEA, ANZ, ASEAN, Greater China) onto the UN M49 standard.
 *
 * The taxonomy itself is covered by unit tests. What is only reachable through
 * the browser is `SelectField`'s optgroup grouping — it builds runs from
 * consecutive options, so a reordering of REGIONS would silently produce
 * duplicate or split headings without failing anything else.
 */

const M49_TOP_LEVEL = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];

const RETIRED_INTERNAL_NAMES = [
  'NA',
  'LATAM',
  'UK&I',
  'Nordics',
  'CEE',
  'MEA',
  'ANZ',
  'ASEAN',
  'Greater China',
];

test.describe('region picker', () => {
  test('offers standard names, never Microsoft-internal ones', async ({ page }) => {
    await page.goto('/assess/1');

    const labels = await page.locator('#region option').allTextContents();
    expect(labels).toHaveLength(17);

    for (const internal of RETIRED_INTERNAL_NAMES) {
      expect(labels, `"${internal}" is an internal area name`).not.toContain(internal);
    }

    // A few M49 sub-regions that must be present.
    for (const standard of ['Northern America', 'Northern Europe', 'South-eastern Asia']) {
      expect(labels).toContain(standard);
    }
  });

  test('groups regions under their parent region exactly once each', async ({ page }) => {
    await page.goto('/assess/1');

    const groups = await page.locator('#region optgroup').evaluateAll((els) =>
      els.map((e) => (e as HTMLOptGroupElement).label),
    );

    expect(groups).toEqual(M49_TOP_LEVEL);
    // A split run would repeat a heading; catching that is the point.
    expect(new Set(groups).size).toBe(groups.length);

    const grouped = await page.locator('#region optgroup option').count();
    const total = await page.locator('#region option').count();
    expect(grouped, 'every region should sit inside a group').toBe(total);
  });

  test('the benchmark filter is grouped and keeps its ungrouped "all" row', async ({ page }) => {
    await page.goto('/benchmark');

    const groups = await page.locator('#f-region optgroup').evaluateAll((els) =>
      els.map((e) => (e as HTMLOptGroupElement).label),
    );
    expect(groups).toEqual(M49_TOP_LEVEL);

    // "All regions" has no group and must still render, which is the mixed
    // grouped/ungrouped case in SelectField.
    const ungrouped = page.locator('#f-region > option');
    await expect(ungrouped).toHaveCount(1);
    await expect(ungrouped).toHaveText('All regions');
  });

  test('a selected region survives a reload', async ({ page }) => {
    await page.goto('/assess/1');
    await page.selectOption('#region', 'Australia and New Zealand');
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('#region')).toHaveValue('Australia and New Zealand');
  });
});
