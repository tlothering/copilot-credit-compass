import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { runEngine } from '@/lib/engine';
import { defaultAnswers } from '@/lib/schemas/answers';
import type { Answers } from '@/lib/schemas/answers';
import { buildExport } from '@/lib/export';

/**
 * GitHub AI credits and Microsoft Copilot Credits both cost $0.01, which makes them
 * dangerously easy to add together. The CreditModel sheet prices its total at the
 * Microsoft pay-as-you-go and capacity-pack rates, so a GitHub line inside that total
 * would be priced against a vehicle that cannot fund it — a wrong number in a
 * spreadsheet a customer will take to their finance team. These tests read the
 * workbook back and check the arithmetic actually written into the cells.
 */

function mixedAnswers(): Answers {
  const base = defaultAnswers();
  return {
    ...base,
    workloads: ['github-copilot', 'copilot-studio-agents'],
    usage: {
      'github-copilot': { seats: 400, plan: 'business', heavyUserPct: 100, modelTier: 'premium' },
      'copilot-studio-agents': {
        ...((base.usage as Record<string, Record<string, unknown>>)['copilot-studio-agents'] ?? {}),
      },
    },
  } as Answers;
}

async function readBack(answers: Answers) {
  const blob = await buildExport('xlsx', { answers, result: runEngine(answers) });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

/** Parses `SUM(H6:H9)` into its inclusive row bounds. */
function sumRows(formula: string): [number, number] | null {
  const m = /SUM\(([A-Z]{1,3})(\d+):[A-Z]{1,3}(\d+)\)/.exec(formula);
  return m ? [Number(m[2]), Number(m[3])] : null;
}

describe('XLSX credit meter separation', () => {
  it('excludes GitHub AI credit rows from the Microsoft total that gets priced', async () => {
    const answers = mixedAnswers();
    const result = runEngine(answers);
    const msCount = result.credits.lines.filter(
      (l) => l.currency === 'microsoft-copilot-credit',
    ).length;
    const otherCount = result.credits.lines.length - msCount;
    expect(msCount).toBeGreaterThan(0);
    expect(otherCount).toBeGreaterThan(0);

    const ws = (await readBack(answers)).getWorksheet('CreditModel');
    expect(ws).toBeDefined();

    const totalRow = ws!.findRow(
      ws!.getColumn(1).values.findIndex(
        (v) => typeof v === 'string' && v.startsWith('Total (Microsoft Copilot Credits)'),
      ),
    );
    expect(totalRow, 'Microsoft total row').toBeDefined();

    const cell = totalRow!.getCell(8).value as { formula?: string } | null;
    expect(cell?.formula, 'Microsoft total is a live formula').toBeTruthy();
    const bounds = sumRows(cell!.formula!);
    expect(bounds, cell!.formula).not.toBeNull();

    const [from, to] = bounds!;
    // Spans exactly the Microsoft lines — no more, no fewer, and never inverted.
    expect(to - from + 1).toBe(msCount);
    expect(to).toBeGreaterThanOrEqual(from);

    // Every row inside the summed range is a Microsoft line, so the GitHub rows,
    // which sit below the total, cannot be inside it.
    const ghLabels = new Set(
      result.credits.lines
        .filter((l) => l.currency !== 'microsoft-copilot-credit')
        .map((l) => l.label),
    );
    for (let r = from; r <= to; r += 1) {
      expect(ghLabels.has(String(ws!.getRow(r).getCell(2).value)), `row ${r}`).toBe(false);
    }
  }, 60_000);

  it('still reports the GitHub credits, under their own clearly labelled total', async () => {
    const ws = (await readBack(mixedAnswers())).getWorksheet('CreditModel');
    const labels = (ws!.getColumn(1).values as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
    expect(labels.some((l) => l.startsWith('Total (GitHub AI credits)'))).toBe(true);
    expect(labels.some((l) => l.includes('Billed on another meter'))).toBe(true);
  }, 60_000);

  it('omits the other-meter block entirely for a Microsoft-only estate', async () => {
    const answers = { ...defaultAnswers(), workloads: ['copilot-studio-agents'] } as Answers;
    const ws = (await readBack(answers)).getWorksheet('CreditModel');
    const labels = (ws!.getColumn(1).values as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
    expect(labels.some((l) => l.includes('Billed on another meter'))).toBe(false);
  }, 60_000);
});
