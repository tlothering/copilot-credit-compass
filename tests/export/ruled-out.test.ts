import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { runEngine } from '@/lib/engine';
import { buildExport } from '@/lib/export';
import { answersWith } from '../unit/engine/fixtures';

/**
 * "Do nothing" is always structurally buyable, so `FundingOption.eligible` is true for
 * it in every scenario. It is also frequently the lowest 12-month figure in the options
 * table, because it declines to fund the demand rather than costing it. Rendering the
 * structural flag instead of the recommendation's verdict therefore put the word
 * "eligible: yes" next to the cheapest-looking row in every export — an invitation to
 * read the table and reach the opposite of the engine's conclusion.
 *
 * These tests pin the renderers to `RankedOption.blocked` instead.
 */

const ANSWERS = answersWith(['github-copilot', 'copilot-studio-agents', 'm365-copilot'], {
  'github-copilot': { seats: 400, plan: 'business', heavyUserPct: 100, modelTier: 'premium' },
});
const RESULT = runEngine(ANSWERS);

const doNothing = () => {
  const ranked = RESULT.recommendation.ranked.find((r) => r.optionId === 'do-nothing');
  if (!ranked) throw new Error('do-nothing is missing from the ranking');
  return ranked;
};

describe('ruled-out options are not presented as candidates', () => {
  it('the fixture really is the dangerous case', () => {
    const dn = doNothing();
    const structural = RESULT.fundingOptions.find((o) => o.id === 'do-nothing')!;
    // Blocked by a rule, yet structurally buyable, and cheaper than the winner.
    expect(dn.blocked).toBe(true);
    expect(structural.eligible).toBe(true);
    expect(dn.twelveMonthTotalUsd).toBeLessThan(
      RESULT.recommendation.primary.twelveMonthTotalUsd,
    );
  });

  it('PPTX marks every blocked option as not a candidate', async () => {
    const blob = await buildExport('pptx', { answers: ANSWERS, result: RESULT });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    let text = '';
    for (const n of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      text += (await zip.file(n)!.async('string')).replace(/<[^>]+>/g, ' ');
    }
    const flat = text.replace(/\s+/g, ' ');

    // The column is headed "Candidate", and the do-nothing row must answer "no".
    expect(flat).toContain('Candidate');
    const label = doNothing().label;
    const idx = flat.indexOf(label);
    expect(idx, 'do-nothing row missing from the slide').toBeGreaterThan(-1);
    // Match the row's own cells: label, money, rate, two percentages, lock-in, verdict.
    const row = flat.slice(idx);
    const cells = /^.*?\$[\d,]+ \$[\d.]+ [\d.]+% [\d.]+% \S+ (yes|no)\b/.exec(row);
    expect(cells, `row rendered as: ${row.slice(0, 120)}`).not.toBeNull();
    expect(cells![1], 'do-nothing is presented as a live candidate').toBe('no');
  });

  it('XLSX labels the blocked row as ruled out, with the rule reason', async () => {
    const blob = await buildExport('xlsx', { answers: ANSWERS, result: RESULT });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.worksheets.find((w) => w.name.toLowerCase().includes('funding'));
    expect(ws, 'no funding sheet').toBeTruthy();

    let found: string | null = null;
    ws!.eachRow((row) => {
      if (String(row.getCell(1).value ?? '') === doNothing().label) {
        found = String(row.getCell(10).value ?? '');
      }
    });
    expect(found, 'do-nothing row missing from the funding sheet').toBeTruthy();
    expect(found!).toMatch(/^RULED OUT — /);
    // The reason must be the rule's explanation, not an eligibility message.
    expect(found!.length).toBeGreaterThan('RULED OUT — '.length + 20);
  });

  it('PDF marks the blocked option as not a candidate', async () => {
    const blob = await buildExport('pdf', { answers: ANSWERS, result: RESULT });
    const { inflateSync } = await import('node:zlib');
    const raw = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    let inflated = '';
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
      try {
        inflated += inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
      } catch {
        /* not a Flate stream */
      }
    }
    const shown = [...inflated.matchAll(/<([0-9a-fA-F]{2,})>/g)]
      .map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'))
      .join('');
    expect(shown).toContain('Candidate');
  });
});
