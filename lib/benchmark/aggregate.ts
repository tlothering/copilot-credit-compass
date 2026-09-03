import { getRateCard } from '@/lib/engine/rate-card';
import { EMPLOYEE_BANDS, INDUSTRIES, REGIONS } from '@/lib/schemas/taxonomy';
import type { StoredRecord } from './record';

export interface Percentiles {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface CohortSummary {
  cohort: string;
  /** Human-readable label for the cohort key. */
  label: string;
  /** How the cohort was formed — exact, or rolled up because it was too thin. */
  granularity: 'industry+region+size' | 'industry+region' | 'industry' | 'all';
  n: number;
  creditsPerKwPerMonth: Percentiles;
  costPerKwPerMonth: Percentiles;
  medianAgentCount: number;
  topWorkloads: { workloadId: string; sharePct: number }[];
  topStrategy: { strategy: string; sharePct: number } | null;
  lastUpdated: string;
}

export interface BenchmarkSummary {
  kAnonymityMinimum: number;
  totalRecords: number;
  publishedRecords: number;
  rejectedOutliers: number;
  lastUpdated: string | null;
  cohorts: CohortSummary[];
  headline: {
    assessments: number;
    organisationsContributing: number;
    medianCreditsPerKwPerMonth: number | null;
    mostRecommendedStrategy: string | null;
  };
  byIndustry: {
    industry: string;
    n: number;
    medianCreditsPerKwPerMonth: number;
    medianAgentCount: number;
    topStrategy: string | null;
  }[];
  workloadAdoption: { workloadId: string; n: number; sharePct: number }[];
  limitations: string[];
}

export const LIMITATIONS = [
  'Every figure here is self-reported by someone completing a five-minute questionnaire. Nobody has audited a single number.',
  'The sample is self-selected: organisations that seek out a credit calculator are not a random sample of Microsoft customers.',
  'Cohorts are small. A median over eight organisations is an anecdote with a decimal point.',
  'Submissions are estimates of future consumption, not measurements of actual invoices.',
  'No cohort with fewer than the k-anonymity minimum is published, so some industries and regions are absent entirely.',
];

/**
 * Linear-interpolated percentile over a sorted array. Matches Excel's
 * PERCENTILE.INC so that a reader can reproduce these numbers from the CSV.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loV = sorted[lo] ?? 0;
  const hiV = sorted[hi] ?? loV;
  if (lo === hi) return loV;
  return loV + (hiV - loV) * (rank - lo);
}

function percentilesOf(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p25: round2(percentile(sorted, 0.25)),
    p50: round2(percentile(sorted, 0.5)),
    p75: round2(percentile(sorted, 0.75)),
    p90: round2(percentile(sorted, 0.9)),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return round2(percentile(sorted, 0.5));
}

/**
 * Rejects implausible submissions (SPEC §8.2). The ceiling comes from the rate
 * card rather than a literal so that it moves with the model rather than
 * needing a code change.
 */
export function isOutlier(r: StoredRecord): boolean {
  const max = getRateCard().modelAssumptions.outlierMaxMonthlyCredits;
  if (!Number.isFinite(r.monthlyCreditsExpected)) return true;
  if (r.monthlyCreditsExpected > max) return true;
  if (r.monthlyCreditsExpected < 0) return true;
  if (!Number.isFinite(r.creditsPerKnowledgeWorkerPerMonth)) return true;
  // A single knowledge worker consuming more than the whole ceiling is a typo
  // or an attack, not a data point.
  if (r.creditsPerKnowledgeWorkerPerMonth > max) return true;
  if (!Number.isFinite(r.monthlyCostExpectedUsd) || r.monthlyCostExpectedUsd < 0) return true;
  return false;
}

const parts = (cohort: string) => cohort.split('|');

function labelFor(cohort: string, granularity: CohortSummary['granularity']): string {
  const [industry, region, band] = parts(cohort);
  switch (granularity) {
    case 'industry+region+size':
      return `${industry} · ${region} · ${band} employees`;
    case 'industry+region':
      return `${industry} · ${region} · all sizes`;
    case 'industry':
      return `${industry} · all regions and sizes`;
    default:
      return 'All contributors';
  }
}

function summarise(
  cohort: string,
  granularity: CohortSummary['granularity'],
  rows: StoredRecord[],
): CohortSummary {
  const credits = rows.map((r) => r.creditsPerKnowledgeWorkerPerMonth);
  const cost = rows.map((r) =>
    r.creditsPerKnowledgeWorkerPerMonth > 0 && r.monthlyCreditsExpected > 0
      ? (r.monthlyCostExpectedUsd / r.monthlyCreditsExpected) * r.creditsPerKnowledgeWorkerPerMonth
      : 0,
  );

  const workloadCounts = new Map<string, number>();
  for (const r of rows) {
    for (const w of new Set(r.workloads)) {
      workloadCounts.set(w, (workloadCounts.get(w) ?? 0) + 1);
    }
  }
  const topWorkloads = [...workloadCounts.entries()]
    .map(([workloadId, n]) => ({ workloadId, sharePct: round2((n / rows.length) * 100) }))
    .sort((a, b) => b.sharePct - a.sharePct || a.workloadId.localeCompare(b.workloadId))
    .slice(0, 5);

  const strategyCounts = new Map<string, number>();
  for (const r of rows) {
    strategyCounts.set(r.recommendedStrategy, (strategyCounts.get(r.recommendedStrategy) ?? 0) + 1);
  }
  const top = [...strategyCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];

  return {
    cohort,
    label: labelFor(cohort, granularity),
    granularity,
    n: rows.length,
    creditsPerKwPerMonth: percentilesOf(credits),
    costPerKwPerMonth: percentilesOf(cost),
    medianAgentCount: median(rows.map((r) => r.agentCount)),
    topWorkloads,
    topStrategy: top ? { strategy: top[0], sharePct: round2((top[1] / rows.length) * 100) } : null,
    lastUpdated: rows.reduce((a, r) => (r.submittedAt > a ? r.submittedAt : a), rows[0]!.submittedAt),
  };
}

export interface SummaryFilter {
  industry?: string;
  region?: string;
  employeeBand?: string;
}

/**
 * Builds every publishable cohort.
 *
 * A cohort is published only when it holds at least `kAnonymityMinimum`
 * records. When the exact industry|region|size tuple is too thin the rows are
 * rolled up — first dropping size, then region, finally into a single global
 * cohort — exactly as SPEC §8.2 requires. A cohort is never published by
 * lowering the threshold, and the roll-up level is reported so a reader can
 * see that they are looking at a broader group than they asked for.
 */
export function buildSummary(all: StoredRecord[], filter: SummaryFilter = {}): BenchmarkSummary {
  const card = getRateCard();
  const k = card.modelAssumptions.kAnonymityMinimum;

  const clean = all.filter((r) => !isOutlier(r));
  const rejected = all.length - clean.length;

  const filtered = clean.filter(
    (r) =>
      (!filter.industry || r.industry === filter.industry) &&
      (!filter.region || r.region === filter.region) &&
      (!filter.employeeBand || r.employeeBand === filter.employeeBand),
  );

  const exact = new Map<string, StoredRecord[]>();
  for (const r of filtered) {
    const key = `${r.industry}|${r.region}|${r.employeeBand}`;
    const list = exact.get(key) ?? [];
    list.push(r);
    exact.set(key, list);
  }

  const cohorts: CohortSummary[] = [];
  const published = new Set<StoredRecord>();

  for (const [key, rows] of exact) {
    if (rows.length >= k) {
      cohorts.push(summarise(key, 'industry+region+size', rows));
      for (const r of rows) published.add(r);
    }
  }

  // Roll-up 1: drop the size band.
  const byIndustryRegion = new Map<string, StoredRecord[]>();
  for (const r of filtered) {
    if (published.has(r)) continue;
    const key = `${r.industry}|${r.region}|*`;
    const list = byIndustryRegion.get(key) ?? [];
    list.push(r);
    byIndustryRegion.set(key, list);
  }
  for (const [key, rows] of byIndustryRegion) {
    if (rows.length >= k) {
      cohorts.push(summarise(key, 'industry+region', rows));
      for (const r of rows) published.add(r);
    }
  }

  // Roll-up 2: drop the region.
  const byIndustryOnly = new Map<string, StoredRecord[]>();
  for (const r of filtered) {
    if (published.has(r)) continue;
    const key = `${r.industry}|*|*`;
    const list = byIndustryOnly.get(key) ?? [];
    list.push(r);
    byIndustryOnly.set(key, list);
  }
  for (const [key, rows] of byIndustryOnly) {
    if (rows.length >= k) {
      cohorts.push(summarise(key, 'industry', rows));
      for (const r of rows) published.add(r);
    }
  }

  // Roll-up 3: everything that is left, published only as one global cohort.
  const remainder = filtered.filter((r) => !published.has(r));
  if (remainder.length >= k) {
    cohorts.push(summarise('*|*|*', 'all', remainder));
    for (const r of remainder) published.add(r);
  }

  cohorts.sort((a, b) => b.n - a.n || a.cohort.localeCompare(b.cohort));

  const industryRows = new Map<string, StoredRecord[]>();
  for (const r of filtered) {
    const list = industryRows.get(r.industry) ?? [];
    list.push(r);
    industryRows.set(r.industry, list);
  }
  const byIndustry = [...industryRows.entries()]
    .filter(([, rows]) => rows.length >= k)
    .map(([industry, rows]) => {
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.recommendedStrategy, (counts.get(r.recommendedStrategy) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return {
        industry,
        n: rows.length,
        medianCreditsPerKwPerMonth: median(rows.map((r) => r.creditsPerKnowledgeWorkerPerMonth)),
        medianAgentCount: median(rows.map((r) => r.agentCount)),
        topStrategy: top ? top[0] : null,
      };
    })
    .sort((a, b) => b.n - a.n || a.industry.localeCompare(b.industry));

  const workloadCounts = new Map<string, number>();
  for (const r of filtered) {
    for (const w of new Set(r.workloads)) workloadCounts.set(w, (workloadCounts.get(w) ?? 0) + 1);
  }
  const workloadAdoption =
    filtered.length >= k
      ? [...workloadCounts.entries()]
          .map(([workloadId, n]) => ({
            workloadId,
            n,
            sharePct: round2((n / filtered.length) * 100),
          }))
          .sort((a, b) => b.n - a.n || a.workloadId.localeCompare(b.workloadId))
      : [];

  const strategyCounts = new Map<string, number>();
  for (const r of filtered) {
    strategyCounts.set(r.recommendedStrategy, (strategyCounts.get(r.recommendedStrategy) ?? 0) + 1);
  }
  const topStrategy = [...strategyCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];

  const lastUpdated =
    filtered.length > 0
      ? filtered.reduce((a, r) => (r.submittedAt > a ? r.submittedAt : a), filtered[0]!.submittedAt)
      : null;

  return {
    kAnonymityMinimum: k,
    totalRecords: all.length,
    publishedRecords: published.size,
    rejectedOutliers: rejected,
    lastUpdated,
    cohorts,
    headline: {
      assessments: clean.length,
      organisationsContributing: clean.length,
      medianCreditsPerKwPerMonth:
        filtered.length >= k ? median(filtered.map((r) => r.creditsPerKnowledgeWorkerPerMonth)) : null,
      mostRecommendedStrategy: filtered.length >= k && topStrategy ? topStrategy[0] : null,
    },
    byIndustry,
    workloadAdoption,
    limitations: LIMITATIONS,
  };
}

/** Aggregates only — never a raw row (SPEC §8.3). */
export function summaryToCsv(summary: BenchmarkSummary): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];

  lines.push('# Copilot Credit Compass — aggregated benchmark');
  lines.push(`# generated,${new Date().toISOString()}`);
  lines.push(`# k_anonymity_minimum,${summary.kAnonymityMinimum}`);
  lines.push(`# published_records,${summary.publishedRecords}`);
  lines.push(`# rejected_outliers,${summary.rejectedOutliers}`);
  lines.push('# Aggregates only. No individual submission appears in this file.');
  lines.push('');

  lines.push('section,cohort,label,granularity,n,metric,p25,p50,p75,p90');
  for (const c of summary.cohorts) {
    lines.push(
      [
        'cohort',
        esc(c.cohort),
        esc(c.label),
        c.granularity,
        c.n,
        'credits_per_kw_per_month',
        c.creditsPerKwPerMonth.p25,
        c.creditsPerKwPerMonth.p50,
        c.creditsPerKwPerMonth.p75,
        c.creditsPerKwPerMonth.p90,
      ].join(','),
    );
    lines.push(
      [
        'cohort',
        esc(c.cohort),
        esc(c.label),
        c.granularity,
        c.n,
        'usd_per_kw_per_month',
        c.costPerKwPerMonth.p25,
        c.costPerKwPerMonth.p50,
        c.costPerKwPerMonth.p75,
        c.costPerKwPerMonth.p90,
      ].join(','),
    );
  }

  lines.push('');
  lines.push('section,industry,n,median_credits_per_kw_per_month,median_agent_count,top_strategy');
  for (const i of summary.byIndustry) {
    lines.push(
      ['industry', esc(i.industry), i.n, i.medianCreditsPerKwPerMonth, i.medianAgentCount, esc(i.topStrategy)].join(
        ',',
      ),
    );
  }

  lines.push('');
  lines.push('section,workload,n,share_pct');
  for (const w of summary.workloadAdoption) {
    lines.push(['workload', esc(w.workloadId), w.n, w.sharePct].join(','));
  }

  lines.push('');
  lines.push('section,limitation');
  for (const l of summary.limitations) lines.push(['limitation', esc(l)].join(','));

  return lines.join('\n') + '\n';
}

export const FILTERABLE = { INDUSTRIES, REGIONS, EMPLOYEE_BANDS } as const;
