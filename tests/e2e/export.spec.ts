import { test, expect } from '@playwright/test';

/**
 * SPEC §13 acceptance criterion 8: PDF, XLSX and PPTX all export successfully.
 *
 * Asserts real file signatures rather than just a completed download, because
 * a zero-byte or HTML-error-page download would otherwise pass.
 */

const SIGNATURES: Record<string, { magic: Buffer; minBytes: number }> = {
  // %PDF-
  pdf: { magic: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), minBytes: 10_000 },
  // Both XLSX and PPTX are ZIP containers: PK\x03\x04
  xlsx: { magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]), minBytes: 5_000 },
  pptx: { magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]), minBytes: 20_000 },
};

test.describe('exports', () => {
  test.beforeEach(async ({ page }) => {
    // Seed a complete session directly rather than re-walking the wizard: the
    // wizard path is covered by wizard.spec.ts and this test is about the
    // export pipeline.
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
  });

  for (const [kind, { magic, minBytes }] of Object.entries(SIGNATURES)) {
    test(`downloads a real ${kind.toUpperCase()} file`, async ({ page }) => {
      const label = { pdf: /Board pack|PDF/i, xlsx: /Excel model/i, pptx: /Slide deck/i }[kind]!;

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.getByRole('button', { name: label }).click(),
      ]);

      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${kind}$`));

      const path = await download.path();
      expect(path).toBeTruthy();

      const fs = await import('node:fs/promises');
      const bytes = await fs.readFile(path!);

      expect(bytes.length).toBeGreaterThan(minBytes);
      expect(bytes.subarray(0, magic.length).equals(magic)).toBe(true);
    });
  }
});
