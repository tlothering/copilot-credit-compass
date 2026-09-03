import { beforeEach, describe, expect, it } from 'vitest';
import { buildSummary, isOutlier, percentile, summaryToCsv } from '@/lib/benchmark/aggregate';
import type { StoredRecord } from '@/lib/benchmark/record';
import {
  __ageSalt,
  __currentSaltFingerprint,
  __resetRateLimit,
  checkRateLimit,
  clientAddressOf,
} from '@/lib/benchmark/rate-limit';
import { getRateCard } from '@/lib/engine/rate-card';

let seq = 0;
function rec(over: Partial<StoredRecord> = {}): StoredRecord {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    submittedAt: '2026-01-15T00:00:00.000Z',
    cohort: 'Financial Services|UK&I|5k-25k',
    rateCardVersion: 'v1',
    industry: 'Financial Services',
    region: 'UK&I',
    employeeBand: '5k-25k',
    knowledgeWorkerBand: '1k-5k',
    workloads: ['m365-copilot', 'copilot-studio-agents'],
    agentCount: 12,
    monthlyCreditsExpected: 400_000,
    monthlyCostExpectedUsd: 3_200,
    creditsPerKnowledgeWorkerPerMonth: 100,
    m365CopilotLicensedSharePct: 40,
    mixClassicPct: 30,
    mixGenerativePct: 55,
    mixActionPct: 15,
    graphGroundingPct: 20,
    recommendedStrategy: 'packs-plus-payg',
    estimatedAnnualSavingVsPaygUsd: 4_800,
    ...over,
  } as StoredRecord;
}

describe('percentile', () => {
  it('returns 0 for an empty set', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('returns the only value for a single-element set', () => {
    expect(percentile([7], 0.9)).toBe(7);
  });

  it('matches PERCENTILE.INC on a hand-worked example', () => {
    // [10,20,30,40] — rank for p50 is (4-1)*0.5 = 1.5, so 20 + (30-20)*0.5 = 25.
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    // rank for p25 is 0.75 -> 10 + (20-10)*0.75 = 17.5
    expect(percentile([10, 20, 30, 40], 0.25)).toBe(17.5);
    // exact-rank case, lo === hi
    expect(percentile([10, 20, 30], 0.5)).toBe(20);
  });
});

describe('outlier rejection', () => {
  const max = getRateCard().modelAssumptions.outlierMaxMonthlyCredits;

  it('accepts a plausible record', () => {
    expect(isOutlier(rec())).toBe(false);
  });

  it('rejects monthly credits above the rate-card ceiling', () => {
    expect(isOutlier(rec({ monthlyCreditsExpected: max + 1 }))).toBe(true);
  });

  it('rejects negative and non-finite credits', () => {
    expect(isOutlier(rec({ monthlyCreditsExpected: -1 }))).toBe(true);
    expect(isOutlier(rec({ monthlyCreditsExpected: Number.NaN }))).toBe(true);
  });

  it('rejects an impossible per-worker figure', () => {
    expect(isOutlier(rec({ creditsPerKnowledgeWorkerPerMonth: max + 1 }))).toBe(true);
    expect(isOutlier(rec({ creditsPerKnowledgeWorkerPerMonth: Number.NaN }))).toBe(true);
  });

  it('rejects negative or non-finite cost', () => {
    expect(isOutlier(rec({ monthlyCostExpectedUsd: -5 }))).toBe(true);
    expect(isOutlier(rec({ monthlyCostExpectedUsd: Number.NaN }))).toBe(true);
  });
});

describe('k-anonymity', () => {
  const k = getRateCard().modelAssumptions.kAnonymityMinimum;

  it('publishes nothing below the minimum', () => {
    const s = buildSummary(Array.from({ length: k - 1 }, () => rec()));
    expect(s.cohorts).toHaveLength(0);
    expect(s.publishedRecords).toBe(0);
    expect(s.headline.medianCreditsPerKwPerMonth).toBeNull();
    expect(s.headline.mostRecommendedStrategy).toBeNull();
    expect(s.workloadAdoption).toHaveLength(0);
    expect(s.byIndustry).toHaveLength(0);
  });

  it('publishes an exact cohort at exactly the minimum', () => {
    const s = buildSummary(Array.from({ length: k }, () => rec()));
    expect(s.cohorts).toHaveLength(1);
    expect(s.cohorts[0]!.granularity).toBe('industry+region+size');
    expect(s.cohorts[0]!.n).toBe(k);
    expect(s.publishedRecords).toBe(k);
  });

  it('rolls up to industry+region when the size band is too thin', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => rec({ employeeBand: '5k-25k' })),
      ...Array.from({ length: 3 }, () => rec({ employeeBand: '25k-100k' })),
    ];
    const s = buildSummary(rows);
    expect(s.cohorts).toHaveLength(1);
    expect(s.cohorts[0]!.granularity).toBe('industry+region');
    expect(s.cohorts[0]!.cohort).toBe('Financial Services|UK&I|*');
    expect(s.cohorts[0]!.n).toBe(6);
  });

  it('rolls up to industry when the region is also too thin', () => {
    const rows = [
      ...Array.from({ length: 2 }, () => rec({ region: 'UK&I', employeeBand: '5k-25k' })),
      ...Array.from({ length: 2 }, () => rec({ region: 'NA', employeeBand: '25k-100k' })),
      ...Array.from({ length: 2 }, () => rec({ region: 'ASEAN', employeeBand: '1k-5k' })),
    ];
    const s = buildSummary(rows);
    expect(s.cohorts).toHaveLength(1);
    expect(s.cohorts[0]!.granularity).toBe('industry');
    expect(s.cohorts[0]!.n).toBe(6);
  });

  it('falls back to a single global cohort when even the industry is thin', () => {
    const rows = [
      ...Array.from({ length: 2 }, () => rec({ industry: 'Retail & CPG', region: 'NA' })),
      ...Array.from({ length: 2 }, () => rec({ industry: 'Manufacturing', region: 'UK&I' })),
      ...Array.from({ length: 2 }, () => rec({ industry: 'Education', region: 'ASEAN' })),
    ];
    const s = buildSummary(rows);
    expect(s.cohorts).toHaveLength(1);
    expect(s.cohorts[0]!.granularity).toBe('all');
    expect(s.cohorts[0]!.cohort).toBe('*|*|*');
    expect(s.cohorts[0]!.label).toBe('All contributors');
  });

  it('leaves a below-threshold remainder unpublished entirely', () => {
    const rows = [
      ...Array.from({ length: k }, () => rec()),
      ...Array.from({ length: 2 }, () => rec({ industry: 'Education', region: 'ASEAN' })),
    ];
    const s = buildSummary(rows);
    expect(s.cohorts).toHaveLength(1);
    expect(s.publishedRecords).toBe(k);
    expect(s.totalRecords).toBe(k + 2);
  });

  it('excludes outliers from every published figure', () => {
    const max = getRateCard().modelAssumptions.outlierMaxMonthlyCredits;
    const rows = [
      ...Array.from({ length: k }, () => rec({ creditsPerKnowledgeWorkerPerMonth: 100 })),
      rec({ monthlyCreditsExpected: max * 10, creditsPerKnowledgeWorkerPerMonth: max * 10 }),
    ];
    const s = buildSummary(rows);
    expect(s.rejectedOutliers).toBe(1);
    expect(s.cohorts[0]!.n).toBe(k);
    expect(s.cohorts[0]!.creditsPerKwPerMonth.p90).toBe(100);
  });
});

describe('summary filtering and content', () => {
  const k = getRateCard().modelAssumptions.kAnonymityMinimum;

  it('applies industry, region and size filters', () => {
    const rows = [
      ...Array.from({ length: k }, () => rec()),
      ...Array.from({ length: k }, () => rec({ industry: 'Healthcare & Life Sciences' })),
    ];
    expect(buildSummary(rows).cohorts).toHaveLength(2);
    expect(buildSummary(rows, { industry: 'Financial Services' }).cohorts).toHaveLength(1);
    expect(buildSummary(rows, { region: 'NA' }).cohorts).toHaveLength(0);
    expect(buildSummary(rows, { employeeBand: '5k-25k' }).cohorts).toHaveLength(2);
  });

  it('reports the workload mix and the modal strategy', () => {
    const rows = [
      ...Array.from({ length: k }, () => rec({ recommendedStrategy: 'packs-plus-payg' })),
      ...Array.from({ length: k }, () => rec({ recommendedStrategy: 'payg', workloads: ['m365-copilot'] })),
    ];
    const s = buildSummary(rows);
    expect(s.headline.mostRecommendedStrategy).toBe('packs-plus-payg');
    const m365 = s.workloadAdoption.find((w) => w.workloadId === 'm365-copilot');
    expect(m365?.sharePct).toBe(100);
    const studio = s.workloadAdoption.find((w) => w.workloadId === 'copilot-studio-agents');
    expect(studio?.sharePct).toBe(50);
  });

  it('derives cost per knowledge worker from the submitted ratio', () => {
    // 3,200 USD over 400,000 credits = 0.008 USD/credit; at 100 credits per
    // worker that is exactly 0.80 USD per worker per month.
    const s = buildSummary(Array.from({ length: k }, () => rec()));
    expect(s.cohorts[0]!.costPerKwPerMonth.p50).toBe(0.8);
  });

  it('handles a zero-credit record without dividing by zero', () => {
    const s = buildSummary(
      Array.from({ length: k }, () =>
        rec({ monthlyCreditsExpected: 0, creditsPerKnowledgeWorkerPerMonth: 0 }),
      ),
    );
    expect(s.cohorts[0]!.costPerKwPerMonth.p50).toBe(0);
  });

  it('reports no lastUpdated when nothing survives the filter', () => {
    expect(buildSummary([]).lastUpdated).toBeNull();
    expect(buildSummary([]).headline.assessments).toBe(0);
  });

  it('takes lastUpdated as the newest submission', () => {
    const rows = [
      ...Array.from({ length: k }, () => rec({ submittedAt: '2026-01-01T00:00:00.000Z' })),
      rec({ submittedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(buildSummary(rows).lastUpdated).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('CSV export', () => {
  const k = getRateCard().modelAssumptions.kAnonymityMinimum;

  it('contains aggregates and no submission ids', () => {
    const rows = Array.from({ length: k }, () => rec());
    const csv = summaryToCsv(buildSummary(rows));
    expect(csv).toContain('section,cohort,label,granularity,n,metric,p25,p50,p75,p90');
    expect(csv).toContain('credits_per_kw_per_month');
    expect(csv).toContain('section,workload,n,share_pct');
    expect(csv).toContain('section,limitation');
    for (const r of rows) expect(csv).not.toContain(r.id);
    expect(csv).not.toContain('submittedAt');
  });

  it('quotes values that contain commas', () => {
    const csv = summaryToCsv(buildSummary(Array.from({ length: k }, () => rec())));
    // Limitation strings contain commas and must be quoted.
    expect(csv).toMatch(/limitation,"/);
  });

  it('emits a header block even with no data', () => {
    const csv = summaryToCsv(buildSummary([]));
    expect(csv).toContain('# published_records,0');
    expect(csv).toContain('Aggregates only.');
  });
});

describe('rate limiting', () => {
  beforeEach(() => __resetRateLimit());

  it('allows up to the limit then refuses', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit('203.0.113.7', 3).allowed).toBe(true);
    }
    const blocked = checkRateLimit('203.0.113.7', 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('counts each address separately', () => {
    expect(checkRateLimit('198.51.100.1', 1).allowed).toBe(true);
    expect(checkRateLimit('198.51.100.1', 1).allowed).toBe(false);
    expect(checkRateLimit('198.51.100.2', 1).allowed).toBe(true);
  });

  it('reports the remaining allowance', () => {
    expect(checkRateLimit('203.0.113.9', 5).remaining).toBe(4);
    expect(checkRateLimit('203.0.113.9', 5).remaining).toBe(3);
  });

  it('rotates the salt and forgets every bucket after 24 hours', () => {
    const before = __currentSaltFingerprint();
    expect(checkRateLimit('203.0.113.11', 1).allowed).toBe(true);
    expect(checkRateLimit('203.0.113.11', 1).allowed).toBe(false);
    __ageSalt(25 * 60 * 60 * 1000);
    expect(checkRateLimit('203.0.113.11', 1).allowed).toBe(true);
    expect(__currentSaltFingerprint()).not.toBe(before);
  });

  it('expires an individual bucket after the window even without rotation', () => {
    const t0 = Date.now();
    expect(checkRateLimit('203.0.113.12', 1, t0).allowed).toBe(true);
    expect(checkRateLimit('203.0.113.12', 1, t0).allowed).toBe(false);
    expect(checkRateLimit('203.0.113.12', 1, t0 + 25 * 60 * 60 * 1000).allowed).toBe(true);
  });
});

describe('client address extraction', () => {
  const req = (h: Record<string, string>) => new Request('https://example.test', { headers: h });

  it('prefers the first X-Forwarded-For hop', () => {
    expect(clientAddressOf(req({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18' }))).toBe(
      '203.0.113.5',
    );
  });

  it('falls back through the Azure, nginx and Cloudflare headers', () => {
    expect(clientAddressOf(req({ 'x-azure-clientip': '203.0.113.6' }))).toBe('203.0.113.6');
    expect(clientAddressOf(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientAddressOf(req({ 'cf-connecting-ip': '203.0.113.8' }))).toBe('203.0.113.8');
  });

  it('returns a constant when nothing identifies the caller', () => {
    expect(clientAddressOf(req({}))).toBe('unknown');
    expect(clientAddressOf(req({ 'x-forwarded-for': '  ' }))).toBe('unknown');
  });
});
