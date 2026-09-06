import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { inflateSync } from 'node:zlib';
import { runEngine } from '@/lib/engine';
import { buildExport } from '@/lib/export';
import { answersWith } from '../unit/engine/fixtures';

/**
 * Structural smoke tests prove an export is a valid file. They do not prove it carries
 * the right numbers, which is the only thing a customer actually takes to their finance
 * team. A transcription slip in an export writer is invisible to every other test in the
 * suite — one shipped here already (the CreditModel sheet priced GitHub AI credits
 * against Microsoft vehicles). These tests pin the headline figures in all three formats
 * to the engine that produced them.
 */

// A deliberately mixed estate: GitHub with real overage on its own meter, plus Microsoft
// workloads on the Copilot Credit meter, so a writer that conflates the two is caught.
const ANSWERS = answersWith(['github-copilot', 'copilot-studio-agents', 'm365-copilot'], {
  'github-copilot': { seats: 400, plan: 'business', heavyUserPct: 100, modelTier: 'premium' },
});

const RESULT = runEngine(ANSWERS);

const usd0 = (n: number) => Math.round(n).toLocaleString('en-US');

describe('exports agree with the engine that produced them', () => {
  it('the fixture really does exercise both meters', () => {
    expect(RESULT.credits.billableCredits).toBeGreaterThan(0);
    expect(RESULT.credits.otherMeterBillableCredits).toBeGreaterThan(0);
    expect(RESULT.credits.byCurrency.length).toBe(2);
  });

  it('XLSX carries the engine figures, not a re-derivation', async () => {
    const blob = await buildExport('xlsx', { answers: ANSWERS, result: RESULT });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());

    // Every numeric cell in the workbook, so we can assert presence without pinning
    // to a row index that legitimate layout changes would break.
    const numbers: number[] = [];
    const strings: string[] = [];
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value as unknown;
          if (typeof v === 'number') numbers.push(v);
          else if (typeof v === 'string') strings.push(v);
          else if (v && typeof v === 'object' && 'result' in (v as object)) {
            const r = (v as { result?: unknown }).result;
            if (typeof r === 'number') numbers.push(r);
          }
        });
      });
    }

    const has = (target: number) => numbers.some((n) => Math.abs(n - target) < 0.51);
    expect(has(RESULT.credits.billableCredits), 'Microsoft billable credits').toBe(true);
    expect(has(RESULT.credits.otherMeterBillableCredits), 'GitHub AI credits').toBe(true);
    expect(has(RESULT.recommendation.primary.twelveMonthTotalUsd), '12-month total').toBe(true);

    // The rate card version must be stamped so a stale export is identifiable.
    expect(strings.join(' ')).toContain(RESULT.rateCardVersion);
  });

  it('PPTX names the recommended option and its 12-month total', async () => {
    const blob = await buildExport('pptx', { answers: ANSWERS, result: RESULT });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    let text = '';
    for (const name of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      text += (await zip.file(name)!.async('string')).replace(/<[^>]+>/g, ' ');
    }
    const flat = text.replace(/\s+/g, ' ');

    expect(flat).toContain(RESULT.recommendation.primary.label);
    expect(flat).toContain(usd0(RESULT.recommendation.primary.twelveMonthTotalUsd));
    expect(flat).toContain(RESULT.rateCardVersion);
  });

  it('PDF carries the recommended option and the rate card version', async () => {
    const blob = await buildExport('pdf', { answers: ANSWERS, result: RESULT });
    const raw = Buffer.from(await blob.arrayBuffer()).toString('latin1');

    // @react-pdf compresses its content streams and emits text as hex strings inside
    // TJ arrays against an ASCII-mapped subset font. Inflate, then decode the hex.
    let inflated = '';
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
      try {
        inflated += inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
      } catch {
        /* not a Flate stream; skip */
      }
    }
    const shown = [...inflated.matchAll(/<([0-9a-fA-F]{2,})>/g)]
      .map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'))
      .join('');

    expect(shown.length, 'no extractable text in the PDF').toBeGreaterThan(200);
    const squashed = shown.replace(/\s+/g, '');
    expect(squashed).toContain(RESULT.recommendation.primary.label.replace(/\s+/g, ''));
    expect(squashed).toContain(RESULT.rateCardVersion);
  });
});
