import { describe, expect, it } from 'vitest';
import { runEngine } from '@/lib/engine';
import { defaultAnswers } from '@/lib/schemas/answers';
import { buildExport } from '@/lib/export';

/**
 * Exports are generated on the server, so they are exercised here in Node
 * exactly as the route handler runs them. These assert real bytes: a PDF magic
 * number, and the ZIP local-file-header that every OOXML container starts with.
 */
const answers = defaultAnswers();
const result = runEngine(answers);

async function head(blob: Blob, n: number) {
  return new Uint8Array((await blob.arrayBuffer()).slice(0, n));
}

describe('exports', () => {
  it('builds a PDF with a %PDF- header', async () => {
    const blob = await buildExport('pdf', { answers, result });
    expect(blob.size).toBeGreaterThan(10_000);
    expect(new TextDecoder().decode(await head(blob, 5))).toBe('%PDF-');
  }, 60_000);

  it('builds an XLSX that is a valid ZIP container', async () => {
    const blob = await buildExport('xlsx', { answers, result });
    expect(blob.size).toBeGreaterThan(5_000);
    expect([...(await head(blob, 4))]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  }, 60_000);

  it('builds a PPTX that is a valid ZIP container', async () => {
    const blob = await buildExport('pptx', { answers, result });
    expect(blob.size).toBeGreaterThan(5_000);
    expect([...(await head(blob, 4))]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  }, 60_000);
});
