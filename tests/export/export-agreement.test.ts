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

/**
 * Every page kicker in the PDF. Canaries prove the extraction reached every page; they do
 * not prove it read each page whole — see the token-count invariant in `pdfText`, which is
 * the guard that actually catches a partial read.
 */
const PDF_PAGE_CANARIES = [
  'COPILOT CREDIT COMPASS',
  'EXECUTIVE SUMMARY',
  'RECOMMENDATION & RATIONALE',
  'FINANCIAL MODEL',
  'TECHNICAL APPENDIX',
  'IMPLEMENTATION ROADMAP',
  'RISK & GOVERNANCE REGISTER',
  'NEGOTIATION BRIEF',
  'BENCHMARK CONTEXT',
  'METHODOLOGY & DISCLAIMER',
];

/**
 * @react-pdf compresses its content streams and emits text as hex strings inside TJ
 * arrays against an ASCII-mapped subset font. Inflate, then decode the hex.
 *
 * An extractor can under-read without failing, and then every `toContain` built on it
 * passes against a partial document while reporting more confidence than it earned. An
 * independent reviewer hit exactly that: a TJ-array pattern accepting only integer
 * kerning values discarded any array containing a fractional kern and read 81% of the
 * file while looking healthy. This document does contain them — 54 of its 836 TJ arrays
 * carry a decimal kern — so the defect is live here, not hypothetical.
 *
 * Two guards, because they catch different things and the weaker one alone is not enough:
 *
 *  - Per-page canaries catch an extraction that misses whole pages. On their own they are
 *    insufficient: replaying the reviewer's defect against this document drops 31% of the
 *    text and *all ten canaries still survive*, because page kickers are short strings
 *    that happen to sit in integer-kern arrays.
 *  - The token-count invariant is the real guard. Every hex token inside a TJ array must
 *    appear in the output. The array pattern here is deliberately permissive — it never
 *    looks at kerning at all — so it cannot be defeated by the formatting that defeats a
 *    structure-parsing extractor. Under the reviewer's defect this fails 5,858 vs 8,489.
 */
async function pdfText(blob: Blob): Promise<string> {
  const raw = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  let inflated = '';
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      inflated += inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      /* not a Flate stream; skip */
    }
  }
  const tokens = [...inflated.matchAll(/<([0-9a-fA-F]{2,})>/g)];
  const shown = tokens.map((m) => Buffer.from(m[1]!, 'hex').toString('latin1')).join('');

  const inTjArrays = [...inflated.matchAll(/\[([^\]]*)\]\s*TJ/g)].flatMap((m) => [
    ...m[1]!.matchAll(/<([0-9a-fA-F]{2,})>/g),
  ]).length;
  expect(
    tokens.length,
    `extraction is partial — ${inTjArrays - tokens.length} of ${inTjArrays} text tokens were dropped`,
  ).toBeGreaterThanOrEqual(inTjArrays);
  // The invariant above is only as strong as the slack between the two counts. Today it
  // is zero — every hex token this writer emits sits inside a TJ array — so a dropped
  // token cannot hide. If @react-pdf ever emits hex elsewhere (font or metadata strings),
  // the global scan gains headroom and the invariant silently loosens by exactly that
  // many tokens, with nothing to say so. Assert the slack rather than commenting on it,
  // so the drift is a test failure and not a quiet erosion. Checked after the partial-read
  // assertion so a genuine under-read reports as an under-read, not as negative slack.
  expect(
    tokens.length - inTjArrays,
    'the global hex scan now sees tokens outside TJ arrays; the invariant above has ' +
      'gained that much headroom and no longer pins the extraction tightly',
  ).toBe(0);

  const squashed = shown.replace(/\s+/g, '');
  for (const canary of PDF_PAGE_CANARIES) {
    expect(squashed, `extraction is partial — "${canary}" is missing`).toContain(
      canary.replace(/\s+/g, ''),
    );
  }
  return squashed.toLowerCase();
}

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
    const squashed = await pdfText(blob);

    expect(squashed).toContain(RESULT.recommendation.primary.label.replace(/\s+/g, '').toLowerCase());
    expect(squashed).toContain(RESULT.rateCardVersion.toLowerCase());
  });
});

/* ------------------------------------------------------------------ no-decision */

// A GitHub-only estate has zero Microsoft credit demand, so no funding instrument does
// anything. The engine says so in `noDecisionRequired`, but the export writers each
// compose their own call-to-action copy from `primary.label`. Left alone they emit
// "Approve Do nothing at $936,000" onto a slide destined for a finance audience, which
// reads as a recommendation to accept a cost rather than as an absence of a decision.
const NO_DECISION_ANSWERS = answersWith(['github-copilot'], {
  'github-copilot': { seats: 2000, plan: 'enterprise', heavyUserPct: 10, modelTier: 'economy' },
});
const NO_DECISION = runEngine(NO_DECISION_ANSWERS);

describe('exports do not ask a customer to approve a decision that does not exist', () => {
  it('the fixture really has no Microsoft credit demand', () => {
    expect(NO_DECISION.credits.billableCredits).toBe(0);
    expect(NO_DECISION.recommendation.noDecisionRequired).toBe(true);
    expect(NO_DECISION.recommendation.primary.optionId).toBe('do-nothing');
    expect(NO_DECISION.recommendation.primary.twelveMonthTotalUsd).toBeGreaterThan(0);
  });

  it('the deck never says "approve do nothing"', async () => {
    const blob = await buildExport('pptx', {
      answers: NO_DECISION_ANSWERS,
      result: NO_DECISION,
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    let text = '';
    for (const name of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      text += (await zip.file(name)!.async('string')).replace(/<[^>]+>/g, ' ');
    }
    const flat = text.replace(/\s+/g, ' ').toLowerCase();

    expect(flat).not.toContain('approve do nothing');
    expect(flat).toContain('no credit funding instrument to approve');
    expect(flat).toContain('no microsoft credit funding decision required');
    // Eight identical seven-figure rows read as a tool that did nothing unless the deck
    // says why they are identical.
    expect(flat).toContain('identical because none of them touch this spend');
    expect(flat).toContain('choosing between them would change nothing');
  });

  it('the pdf never says "adopt do nothing" as the funding route', async () => {
    const blob = await buildExport('pdf', {
      answers: NO_DECISION_ANSWERS,
      result: NO_DECISION,
    });
    const squashed = await pdfText(blob);

    expect(squashed).not.toContain('adoptdonothing');
    expect(squashed).toContain('nothing,ontheseassumptions');
    // The rationale page must not open with the option label next to a seven-figure
    // number; the no-decision framing leads and the label follows underneath.
    expect(squashed).toContain('nomicrosoftcreditfundingdecisionrequired');
    expect(squashed).toContain('itdoesnotmeannocost');
  });
});
