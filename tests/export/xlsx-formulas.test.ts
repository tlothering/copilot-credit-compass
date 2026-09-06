import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { runEngine } from '@/lib/engine';
import { defaultAnswers } from '@/lib/schemas/answers';
import { buildExport } from '@/lib/export';

/**
 * Every table in the XLSX writer records `start = rowCount + 1` before its loop
 * and `end = rowCount` after it. A table with no body rows therefore leaves
 * `end = start - 1`, which naively produces an inverted aggregate range such as
 * `SUM(C5:C4)`. Excel normalises that silently, so it is invisible in the UI —
 * but it is malformed, and it is reachable through the export API with an empty
 * workload selection. These tests unzip the real bytes and read the sheet XML
 * rather than trusting the writer's own view of what it emitted.
 */

/** Minimal ZIP reader: walk the central directory and inflate each entry. */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  // End of central directory record: signature 0x06054b50, scanned backwards
  // because it is followed by a variable-length comment.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name and carries its own extra field, whose
    // length may differ from the central one.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    files.set(name, (method === 0 ? raw : inflateRawSync(raw)).toString('utf8'));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const RANGE = /\b([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)\b/g;

function invertedRanges(formula: string): string[] {
  const bad: string[] = [];
  for (const m of formula.matchAll(RANGE)) {
    const [whole, c1, r1, c2, r2] = m;
    if (c1 === c2 && Number(r2) < Number(r1)) bad.push(whole);
  }
  return bad;
}

function formulasIn(xml: string): string[] {
  return [...xml.matchAll(/<f(?:\s[^>]*)?>([^<]*)<\/f>/g)].map((m) =>
    m[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  );
}

async function sheetFormulas(answers: ReturnType<typeof defaultAnswers>) {
  const blob = await buildExport('xlsx', { answers, result: runEngine(answers) });
  const files = unzip(Buffer.from(await blob.arrayBuffer()));
  const out = new Map<string, string[]>();
  for (const [name, xml] of files) {
    if (name.startsWith('xl/worksheets/') && name.endsWith('.xml')) {
      out.set(name, formulasIn(xml));
    }
  }
  return out;
}

describe('XLSX aggregate ranges', () => {
  it('emits no inverted range for a fully populated workbook', async () => {
    const sheets = await sheetFormulas(defaultAnswers());
    expect(sheets.size).toBeGreaterThan(0);
    for (const [sheet, formulas] of sheets) {
      for (const f of formulas) expect(invertedRanges(f), `${sheet}: ${f}`).toEqual([]);
    }
  }, 60_000);

  it('emits no inverted range when no workloads are selected', async () => {
    // The regression: with zero volume and zero credit lines, every table body
    // is empty and each `SUM(x{start}:x{start-1})` would be malformed.
    const empty = { ...defaultAnswers(), workloads: [], usage: {} } as ReturnType<
      typeof defaultAnswers
    >;
    const sheets = await sheetFormulas(empty);
    expect(sheets.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [sheet, formulas] of sheets) {
      for (const f of formulas) {
        for (const r of invertedRanges(f)) offenders.push(`${sheet}: ${f} (${r})`);
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it('still keeps the workbook live rather than falling back to pasted values', async () => {
    const sheets = await sheetFormulas(defaultAnswers());
    const total = [...sheets.values()].reduce((n, f) => n + f.length, 0);
    expect(total).toBeGreaterThan(20);
  }, 60_000);
});

describe('inverted range detector', () => {
  it('recognises the shape it is guarding against', () => {
    expect(invertedRanges('SUM(C5:C4)')).toEqual(['C5:C4']);
    expect(invertedRanges('SUM(C5:C9)')).toEqual([]);
    expect(invertedRanges('SUM(A1:D1)')).toEqual([]);
  });
});
