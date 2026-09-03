import { NextResponse } from 'next/server';
import { buildSummary, summaryToCsv } from '@/lib/benchmark/aggregate';
import { getStore } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aggregates only. There is deliberately no endpoint that returns raw rows. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const all = await getStore().all();
    const summary = buildSummary(all, {
      industry: url.searchParams.get('industry') ?? undefined,
      region: url.searchParams.get('region') ?? undefined,
      employeeBand: url.searchParams.get('employeeBand') ?? undefined,
    });
    return new NextResponse(summaryToCsv(summary), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="copilot-credit-compass-benchmark.csv"',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Benchmark unavailable.' }, { status: 503 });
  }
}
