import type { Answers } from '@/lib/schemas/answers';
import type { EngineResult } from '@/lib/engine/types';

export type ExportKind = 'pdf' | 'xlsx' | 'pptx';

export interface ExportInput {
  answers: Answers;
  result: EngineResult;
}

/**
 * Single entry point for every export format. Each generator is dynamically
 * imported so that none of @react-pdf/renderer, exceljs or pptxgenjs is pulled
 * into the results-page bundle unless the user actually asks for that file.
 */
export async function buildExport(kind: ExportKind, input: ExportInput): Promise<Blob> {
  switch (kind) {
    case 'pdf': {
      const { buildPdf } = await import('./pdf');
      return buildPdf(input);
    }
    case 'xlsx': {
      const { buildXlsx } = await import('./xlsx');
      return buildXlsx(input);
    }
    case 'pptx': {
      const { buildPptx } = await import('./pptx');
      return buildPptx(input);
    }
  }
}
