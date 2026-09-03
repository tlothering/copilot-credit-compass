'use client';

import { useEffect, useState } from 'react';
import type { EngineResult } from '@/lib/engine/types';
import { Badge, Card, CardTitle } from '@/components/ui/primitives';
import { DataTable } from './chart-frame';
import { cn, num, pct } from '@/lib/ui';
import { cohortKey } from '@/lib/benchmark/record';
import { useSession } from '@/lib/store/session';

type Percentiles = { p25: number; p50: number; p75: number; p90: number };
type SummaryCohort = {
  cohort: string;
  n: number;
  creditsPerKwPerMonth: Percentiles;
  costPerKwPerMonth: Percentiles;
  topWorkloads: { workloadId: string; sharePct: number }[];
};

export function BenchmarkPlacement({ result }: { result: EngineResult }) {
  const answers = useSession((s) => s.answers);
  const [cohort, setCohort] = useState<SummaryCohort | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'thin' | 'error'>('loading');

  const key = cohortKey({
    industry: answers.profile.industry,
    region: answers.profile.region,
    employeeBand: answers.profile.employeeBand,
  });
  const kw = Math.max(answers.profile.knowledgeWorkers, 1);
  const yours = result.credits.billableCredits / kw;

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/benchmark/summary?cohort=${encodeURIComponent(key)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { cohorts?: SummaryCohort[] }) => {
        const match = data.cohorts?.find((c) => c.cohort === key) ?? null;
        if (!match || match.n < 5) {
          setCohort(null);
          setState('thin');
        } else {
          setCohort(match);
          setState('ready');
        }
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') setState('error');
      });
    return () => ac.abort();
  }, [key]);

  return (
    <Card>
      <CardTitle
        hint="Credits per knowledge worker per month, against organisations with a similar profile. Cohorts are only published once at least five have contributed."
        right={
          state === 'ready' && cohort ? <Badge tone="info">n = {cohort.n}</Badge> : null
        }
      >
        How you compare
      </CardTitle>

      <p className="text-sm">
        Your estimate is{' '}
        <strong className="mono-num">{yours.toFixed(1)} credits</strong> per knowledge worker per
        month.
      </p>

      {state === 'loading' ? (
        <div className="mt-4 h-16 animate-pulse rounded-field bg-bg-sunken" />
      ) : null}

      {state === 'thin' || state === 'error' ? (
        <p className="mt-3 text-xs text-fg-muted">
          {state === 'error'
            ? 'The benchmark service is not reachable right now, so no comparison is shown. Your own results are unaffected — nothing about this page depends on it.'
            : 'Fewer than five organisations have contributed to your cohort, so no comparison is published. That threshold exists to stop a cohort of one or two being re-identifiable, and it will not be lowered.'}
        </p>
      ) : null}

      {state === 'ready' && cohort ? (
        <>
          <PercentileStrip yours={yours} p={cohort.creditsPerKwPerMonth} />
          <div className="mt-4 overflow-x-auto">
            <DataTable
              caption={`Cohort ${cohort.cohort}, n = ${cohort.n}`}
              columns={['Measure', 'P25', 'P50', 'P75', 'P90', 'You']}
              rows={[
                [
                  'Credits per knowledge worker / month',
                  cohort.creditsPerKwPerMonth.p25.toFixed(1),
                  cohort.creditsPerKwPerMonth.p50.toFixed(1),
                  cohort.creditsPerKwPerMonth.p75.toFixed(1),
                  cohort.creditsPerKwPerMonth.p90.toFixed(1),
                  yours.toFixed(1),
                ],
                [
                  'Cost per knowledge worker / month (USD)',
                  cohort.costPerKwPerMonth.p25.toFixed(2),
                  cohort.costPerKwPerMonth.p50.toFixed(2),
                  cohort.costPerKwPerMonth.p75.toFixed(2),
                  cohort.costPerKwPerMonth.p90.toFixed(2),
                  (result.cost.totalMonthlyUsd / kw).toFixed(2),
                ],
              ]}
            />
          </div>
          {cohort.topWorkloads.length > 0 ? (
            <p className="mt-3 text-xs text-fg-muted">
              Most common workloads in this cohort:{' '}
              {cohort.topWorkloads
                .slice(0, 3)
                .map((w) => `${w.workloadId} (${pct(w.sharePct, 0)})`)
                .join(', ')}
              .
            </p>
          ) : null}
        </>
      ) : null}

      <p className="mt-4 text-2xs text-fg-subtle">
        Cohort key: <span className="font-mono">{key}</span> · your figures are only added to this
        benchmark if you opted in on the review step. {num(result.credits.billableCredits)} billable
        credits ÷ {num(kw)} knowledge workers.
      </p>
    </Card>
  );
}

function PercentileStrip({ yours, p }: { yours: number; p: Percentiles }) {
  const max = Math.max(p.p90 * 1.15, yours * 1.1, 1);
  const at = (v: number) => `${Math.min((v / max) * 100, 100)}%`;
  const marks: [keyof Percentiles, string][] = [
    ['p25', 'P25'],
    ['p50', 'Median'],
    ['p75', 'P75'],
    ['p90', 'P90'],
  ];
  const above = yours > p.p75;

  return (
    <div className="mt-5">
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-4 h-2 rounded-full bg-bg-sunken" />
        <div
          className="absolute top-4 h-2 rounded-full bg-accent/25"
          style={{ left: at(p.p25), width: `calc(${at(p.p75)} - ${at(p.p25)})` }}
        />
        {marks.map(([k, label]) => (
          <div key={k} className="absolute top-0" style={{ left: at(p[k]) }}>
            <span className="absolute -translate-x-1/2 text-2xs text-fg-subtle">{label}</span>
            <span className="absolute top-3 h-4 w-px -translate-x-1/2 bg-line-strong" />
          </div>
        ))}
        <div className="absolute top-2" style={{ left: at(yours) }}>
          <span
            className={cn(
              'absolute top-1.5 size-3 -translate-x-1/2 rounded-full ring-2 ring-bg',
              above ? 'bg-warn' : 'bg-accent',
            )}
          />
          <span className="absolute top-7 -translate-x-1/2 whitespace-nowrap text-2xs font-medium">
            you
          </span>
        </div>
      </div>
      <p className="mt-5 text-xs text-fg-muted">
        {above
          ? 'You are projecting above the third quartile for your cohort. That is not automatically wrong — heavier automation genuinely costs more — but it is worth checking your per-user frequency assumptions before committing budget.'
          : 'You sit inside the interquartile range for your cohort, which is where most credible estimates land.'}
      </p>
    </div>
  );
}
