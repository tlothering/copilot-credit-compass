import { NextResponse } from 'next/server';
import { answersSchema } from '@/lib/schemas/answers';
import { runEngine } from '@/lib/engine';
import { buildExport, type ExportKind } from '@/lib/export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<ExportKind, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function isKind(v: string): v is ExportKind {
  return v === 'pdf' || v === 'xlsx' || v === 'pptx';
}

/**
 * Exports are generated on the server. exceljs, pptxgenjs and @react-pdf all
 * reach for Node built-ins, and shipping ~1.5 MB of generator code to every
 * visitor to make a file they may never ask for is the wrong trade. The answers
 * payload is the same anonymised object the benchmark sees — no PII crosses
 * this boundary — and because the engine is deterministic the server recomputes
 * the identical result rather than trusting a client-supplied one.
 */
export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (!isKind(kind)) {
    return NextResponse.json({ error: 'Unknown export format.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = answersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Answers failed validation.', issues: parsed.error.issues.slice(0, 10) },
      { status: 422 },
    );
  }

  const answers = parsed.data;
  const result = runEngine(answers);
  const blob = await buildExport(kind, { answers, result });
  const bytes = new Uint8Array(await blob.arrayBuffer());

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': MIME[kind],
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="copilot-credit-compass-${result.rateCardVersion}.${kind}"`,
      'Cache-Control': 'no-store',
    },
  });
}
