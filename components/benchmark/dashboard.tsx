'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardTitle } from '@/components/ui/primitives';
import { DataTable } from '@/components/results/chart-frame';
import { SelectField } from '@/components/wizard/fields';
import { EMPLOYEE_BANDS, INDUSTRIES, REGION_OPTIONS, WORKLOAD_IDS, workloadMeta } from '@/lib/schemas/taxonomy';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { fundingOptionLabel } from '@/lib/benchmark/labels';
// Imported, never restated. A local copy of this shape in the landing ticker
// drifted from the API and silently blanked every tile it rendered.
import type { BenchmarkSummary, CohortSummary } from '@/lib/benchmark/aggregate';
import { cn, num, pct } from '@/lib/ui';

/** Ids arrive from the API as bare strings; fall back rather than throw. */
function workloadLabel(id: string): string {
  return (WORKLOAD_IDS as readonly string[]).includes(id)
    ? workloadMeta(id as WorkloadId).label
    : id;
}

const ANY = '__all__';

const opts = (values: readonly string[], allLabel: string) => [
  { value: ANY, label: allLabel },
  ...values.map((v) => ({ value: v, label: v })),
];

/** Same grouping as the wizard picker, with an ungrouped "all" row on top. */
const REGION_FILTER_OPTIONS = [
  { value: ANY, label: 'All regions' },
  ...REGION_OPTIONS.map((o) => ({ ...o, value: o.value as string })),
];

export function BenchmarkDashboard() {
  const [industry, setIndustry] = useState<string>(ANY);
  const [region, setRegion] = useState<string>(ANY);
  const [employeeBand, setBand] = useState<string>(ANY);
  const [data, setData] = useState<BenchmarkSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (industry !== ANY) p.set('industry', industry);
    if (region !== ANY) p.set('region', region);
    if (employeeBand !== ANY) p.set('employeeBand', employeeBand);
    return p.toString();
  }, [industry, region, employeeBand]);

  useEffect(() => {
    const ac = new AbortController();
    setState('loading');
    fetch(`/api/benchmark/summary${qs ? `?${qs}` : ''}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: BenchmarkSummary) => {
        setData(d);
        setState('ready');
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') setState('error');
      });
    return () => ac.abort();
  }, [qs]);

  const clear = useCallback(() => {
    setIndustry(ANY);
    setRegion(ANY);
    setBand(ANY);
  }, []);

  const thin = data !== null && data.cohorts.length === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle
          hint="Everything on this page is aggregated. No individual submission is shown, downloadable, or reachable through any endpoint."
          right={data ? <Badge tone="neutral">k ≥ {data.kAnonymityMinimum}</Badge> : null}
        >
          Filters
        </CardTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <Filter label="Industry" id="f-industry">
            <SelectField
              id="f-industry"
              value={industry}
              options={opts(INDUSTRIES, 'All industries')}
              onChange={setIndustry}
            />
          </Filter>
          <Filter label="Region" id="f-region">
            <SelectField
              id="f-region"
              value={region}
              options={REGION_FILTER_OPTIONS}
              onChange={setRegion}
            />
          </Filter>
          <Filter label="Employees" id="f-band">
            <SelectField
              id="f-band"
              value={employeeBand}
              options={opts(EMPLOYEE_BANDS, 'All sizes')}
              onChange={setBand}
            />
          </Filter>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button variant="ghost" size="sm" onClick={clear} disabled={!qs}>
            Clear filters
          </Button>
          <a
            className="text-xs underline decoration-line-strong underline-offset-4 hover:text-accent"
            href={`/api/benchmark/csv${qs ? `?${qs}` : ''}`}
          >
            Download aggregated CSV
          </a>
          {data?.lastUpdated ? (
            <span className="text-2xs text-fg-subtle">
              Last updated {data.lastUpdated.slice(0, 13)}:00 UTC
            </span>
          ) : null}
        </div>
      </Card>

      {state === 'loading' ? <div className="h-40 animate-pulse rounded-card bg-bg-sunken" /> : null}

      {state === 'error' ? (
        <Card>
          <p className="text-sm text-fg-muted">
            The benchmark service is not reachable. This page is the only thing affected — the
            calculator runs entirely in your browser and does not depend on it.
          </p>
        </Card>
      ) : null}

      {data && state === 'ready' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Counter label="Assessments counted" value={num(data.headline.assessments)} />
            <Counter
              label="Organisations contributing"
              value={num(data.headline.organisationsContributing)}
            />
            <Counter
              label="Median credits / KW / month"
              value={
                data.headline.medianCreditsPerKwPerMonth === null
                  ? 'withheld'
                  : data.headline.medianCreditsPerKwPerMonth.toFixed(1)
              }
              muted={data.headline.medianCreditsPerKwPerMonth === null}
            />
            <Counter
              label="Most recommended strategy"
              value={
                data.headline.mostRecommendedStrategy
                  ? fundingOptionLabel(data.headline.mostRecommendedStrategy)
                  : 'withheld'
              }
              muted={!data.headline.mostRecommendedStrategy}
            />
          </div>

          {thin ? (
            <Card>
              <CardTitle>Not enough data to publish</CardTitle>
              <p className="text-sm text-fg-muted">
                Fewer than {data.kAnonymityMinimum} organisations match this filter, so no
                distribution is shown. That floor is not adjustable from the interface and is not
                lowered because a cohort happens to be interesting. Broaden the filter, or come back
                once more people have contributed.
              </p>
            </Card>
          ) : null}

          {data.cohorts.length > 0 ? (
            <Card>
              <CardTitle hint="Credits per knowledge worker per month is the only figure that compares meaningfully across organisations of different sizes.">
                Distribution by cohort
              </CardTitle>
              <div className="space-y-7">
                {data.cohorts.map((c) => (
                  <CohortRow key={c.cohort} c={c} />
                ))}
              </div>
              <div className="mt-6 overflow-x-auto">
                <DataTable
                  caption="Credits per knowledge worker per month, by cohort"
                  columns={['Cohort', 'Grouping', 'n', 'P25', 'P50', 'P75', 'P90']}
                  rows={data.cohorts.map((c) => [
                    c.label,
                    c.granularity,
                    String(c.n),
                    c.creditsPerKwPerMonth.p25.toFixed(1),
                    c.creditsPerKwPerMonth.p50.toFixed(1),
                    c.creditsPerKwPerMonth.p75.toFixed(1),
                    c.creditsPerKwPerMonth.p90.toFixed(1),
                  ])}
                />
              </div>
            </Card>
          ) : null}

          {data.workloadAdoption.length > 0 ? (
            <Card>
              <CardTitle hint="Share of contributing organisations that selected each workload.">
                Workload adoption
              </CardTitle>
              <ul className="space-y-3">
                {data.workloadAdoption.map((w) => (
                  <li key={w.workloadId} className="grid grid-cols-[1fr_auto] items-center gap-4">
                    <div>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span>{workloadLabel(w.workloadId)}</span>
                        <span className="mono-num text-xs text-fg-muted">{pct(w.sharePct, 0)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-bg-sunken" aria-hidden="true">
                        <div
                          className="h-1.5 rounded-full bg-accent/60"
                          style={{ width: `${Math.min(w.sharePct, 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="mono-num text-2xs text-fg-subtle">n = {w.n}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {data.byIndustry.length > 0 ? (
            <Card>
              <CardTitle hint="Industries below the k-anonymity minimum are omitted entirely rather than shown with a caveat.">
                By industry
              </CardTitle>
              <div className="overflow-x-auto">
                <DataTable
                  caption="Median consumption and most-recommended strategy by industry"
                  columns={[
                    'Industry',
                    'n',
                    'Median credits / KW / month',
                    'Median agents',
                    'Most recommended',
                  ]}
                  rows={data.byIndustry.map((i) => [
                    i.industry,
                    String(i.n),
                    i.medianCreditsPerKwPerMonth.toFixed(1),
                    i.medianAgentCount.toFixed(0),
                    i.topStrategy ? fundingOptionLabel(i.topStrategy) : '—',
                  ])}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardTitle>What this data is not</CardTitle>
            <ul className="space-y-2 text-sm text-fg-muted">
              {data.limitations.map((l) => (
                <li key={l} className="flex gap-2">
                  <span aria-hidden="true" className="text-fg-subtle">
                    —
                  </span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-2xs text-fg-subtle">
              {num(data.totalRecords)} submissions received · {num(data.publishedRecords)} appear in
              a published cohort · {num(data.rejectedOutliers)} rejected as implausible.
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Filter({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function Counter({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tracking-tight mono-num',
          muted && 'text-base text-fg-subtle',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function CohortRow({ c }: { c: CohortSummary }) {
  const max = Math.max(c.creditsPerKwPerMonth.p90 * 1.15, 1);
  const at = (v: number) => `${Math.min((v / max) * 100, 100)}%`;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{c.label}</p>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">n = {c.n}</Badge>
          {c.topStrategy ? (
            <Badge tone="info">
              {fundingOptionLabel(c.topStrategy.strategy)} · {pct(c.topStrategy.sharePct, 0)}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="relative mt-3 h-8" aria-hidden="true">
        <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-bg-sunken" />
        <div
          className="absolute top-3 h-2 rounded-full bg-accent/25"
          style={{
            left: at(c.creditsPerKwPerMonth.p25),
            width: `calc(${at(c.creditsPerKwPerMonth.p75)} - ${at(c.creditsPerKwPerMonth.p25)})`,
          }}
        />
        {(['p25', 'p50', 'p75', 'p90'] as const).map((k) => (
          <span
            key={k}
            className="absolute top-2 h-4 w-px -translate-x-1/2 bg-line-strong"
            style={{ left: at(c.creditsPerKwPerMonth[k]) }}
          />
        ))}
        <span
          className="absolute top-2 size-3 -translate-x-1/2 rounded-full bg-accent ring-2 ring-bg"
          style={{ left: at(c.creditsPerKwPerMonth.p50) }}
        />
      </div>
      <p className="text-2xs text-fg-subtle">
        P25 {c.creditsPerKwPerMonth.p25.toFixed(1)} · median {c.creditsPerKwPerMonth.p50.toFixed(1)}{' '}
        · P75 {c.creditsPerKwPerMonth.p75.toFixed(1)} · P90 {c.creditsPerKwPerMonth.p90.toFixed(1)}{' '}
        credits per knowledge worker per month · median {c.medianAgentCount.toFixed(0)} agents ·
        {' '}n = {c.n}
      </p>
    </div>
  );
}
