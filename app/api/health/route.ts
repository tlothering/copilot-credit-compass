import { NextResponse } from 'next/server';
import { getRateCard } from '@/lib/engine/rate-card';
import { getStore } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness probe for the Container App.
 *
 * Reports the store as degraded rather than failing the probe outright. The
 * assessment, the results dashboard and every export work with no database at
 * all — only the public benchmark needs one. Taking the whole app out of
 * rotation because a benchmark aggregate is unavailable would be the wrong
 * trade.
 *
 * Deliberately returns nothing that identifies a deployment beyond the rate
 * card version, which is public anyway and printed on every export.
 */
export async function GET() {
  const card = getRateCard();

  let store: 'ok' | 'degraded' = 'ok';
  try {
    const healthy = await getStore().ping();
    if (!healthy) store = 'degraded';
  } catch {
    store = 'degraded';
  }

  return NextResponse.json(
    {
      status: 'ok',
      store,
      rateCardVersion: card.version,
      rateCardEffectiveDate: card.effectiveDate,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
