import { NextResponse } from 'next/server';
import { buildSummary, type SummaryFilter } from '@/lib/benchmark/aggregate';
import { getStore } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function filterFrom(url: URL): SummaryFilter {
  const f: SummaryFilter = {};
  const industry = url.searchParams.get('industry');
  const region = url.searchParams.get('region');
  const employeeBand = url.searchParams.get('employeeBand');
  if (industry) f.industry = industry;
  if (region) f.region = region;
  if (employeeBand) f.employeeBand = employeeBand;
  return f;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const all = await getStore().all();
    const summary = buildSummary(all, filterFrom(url));
    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch {
    return NextResponse.json({ error: 'Benchmark unavailable.' }, { status: 503 });
  }
}
