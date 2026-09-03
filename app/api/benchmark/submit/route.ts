import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { benchmarkRecordSchema, cohortKey, type StoredRecord } from '@/lib/benchmark/record';
import { isOutlier } from '@/lib/benchmark/aggregate';
import { checkRateLimit, clientAddressOf } from '@/lib/benchmark/rate-limit';
import { getStore } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Truncates to the hour, per SPEC §8.1. Minute-level timing is a correlation risk. */
function submittedAtHour(now = new Date()): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

export async function POST(req: Request) {
  const rl = checkRateLimit(clientAddressOf(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many submissions from this network today.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  // Strict parse: any field not in the schema is a rejection, not a silent
  // strip. If a future client starts sending something extra we want to find
  // out from a 422, not from discovering it in the database (constraint C1).
  const parsed = benchmarkRecordSchema.strict().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Submission rejected.', issues: parsed.error.issues.slice(0, 10) },
      { status: 422 },
    );
  }

  const record = parsed.data;
  const stored: StoredRecord = {
    ...record,
    id: randomUUID(),
    submittedAt: submittedAtHour(),
    cohort: cohortKey(record),
  };

  if (isOutlier(stored)) {
    // Accepted-but-discarded rather than rejected: telling a caller precisely
    // which threshold they crossed is a probe for the rejection rules.
    return NextResponse.json({ ok: true, counted: false }, { status: 202 });
  }

  try {
    await getStore().insert(stored);
  } catch {
    return NextResponse.json(
      { error: 'The benchmark store is unavailable. Your results are unaffected.' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { ok: true, counted: true, cohort: stored.cohort },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
