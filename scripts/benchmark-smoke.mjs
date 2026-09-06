/**
 * End-to-end smoke test for the public benchmark endpoints.
 *
 * Submits enough synthetic records to clear the k-anonymity floor, then reads
 * the summary and CSV back. Run against a live dev server:
 *
 *   node scripts/benchmark-smoke.mjs [baseUrl]
 *
 * Every value here is synthetic. Nothing in this script reads real input.
 */

const base = process.argv[2] ?? 'http://localhost:3000';

const template = {
  rateCardVersion: 'v1',
  industry: 'Financial Services',
  region: 'Northern Europe',
  employeeBand: '5k-25k',
  knowledgeWorkerBand: '1k-5k',
  workloads: ['copilot-studio-agents', 'sharepoint-agents'],
  agentCount: 12,
  monthlyCreditsExpected: 1045000,
  monthlyCostExpectedUsd: 105000,
  creditsPerKnowledgeWorkerPerMonth: 1300,
  m365CopilotLicensedSharePct: 60,
  mixClassicPct: 40,
  mixGenerativePct: 40,
  mixActionPct: 20,
  graphGroundingPct: 30,
  recommendedStrategy: 'packs-plus-payg',
  estimatedAnnualSavingVsPaygUsd: 120000,
};

const variants = [
  { creditsPerKnowledgeWorkerPerMonth: 900, monthlyCostExpectedUsd: 80000 },
  { creditsPerKnowledgeWorkerPerMonth: 1100, monthlyCostExpectedUsd: 95000 },
  { creditsPerKnowledgeWorkerPerMonth: 1300, monthlyCostExpectedUsd: 105000 },
  { creditsPerKnowledgeWorkerPerMonth: 1500, monthlyCostExpectedUsd: 118000 },
  { creditsPerKnowledgeWorkerPerMonth: 1800, monthlyCostExpectedUsd: 140000 },
  { creditsPerKnowledgeWorkerPerMonth: 2400, monthlyCostExpectedUsd: 175000 },
  { industry: 'Manufacturing', creditsPerKnowledgeWorkerPerMonth: 700 },
];

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

for (const [i, v] of variants.entries()) {
  const res = await fetch(`${base}/api/benchmark/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${i + 1}` },
    body: JSON.stringify({ ...template, ...v }),
  });
  const body = await res.json();
  check(
    `submit #${i + 1}`,
    res.status === 201 && body.counted === true,
    `${res.status} ${body.cohort ?? JSON.stringify(body).slice(0, 120)}`,
  );
}

// An out-of-range submission must be accepted-but-not-counted, never rejected
// with a message that reveals the threshold.
{
  const res = await fetch(`${base}/api/benchmark/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.200' },
    body: JSON.stringify({ ...template, monthlyCreditsExpected: 900000000 }),
  });
  const body = await res.json();
  check(
    'outlier accepted-but-discarded',
    res.status === 202 && body.counted === false,
    String(res.status),
  );
}

// An unexpected field must be a 422, not a silent strip (constraint C1).
{
  const res = await fetch(`${base}/api/benchmark/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.201' },
    body: JSON.stringify({ ...template, companyName: 'Contoso Ltd' }),
  });
  check('unknown field rejected', res.status === 422, String(res.status));
}

{
  const res = await fetch(`${base}/api/benchmark/summary`);
  const s = await res.json();
  check('summary 200', res.status === 200, String(res.status));
  check(
    'summary meets k-anonymity floor',
    s.publishedRecords >= s.kAnonymityMinimum,
    `published=${s.publishedRecords}/${s.totalRecords} k=${s.kAnonymityMinimum}`,
  );
  check(
    'percentiles present',
    typeof s.cohorts?.[0]?.creditsPerKwPerMonth?.p50 === 'number',
    `p50=${s.cohorts?.[0]?.creditsPerKwPerMonth?.p50}`,
  );
  check('cohorts published', Array.isArray(s.cohorts), `${s.cohorts?.length ?? 0} cohort(s)`);
  check(
    'every published cohort clears k',
    (s.cohorts ?? []).every((c) => c.n >= s.kAnonymityMinimum),
    (s.cohorts ?? []).map((c) => `${c.cohort}=${c.n}`).join(', '),
  );
  check('no raw records leaked', !JSON.stringify(s).includes('"id"'), '');
}

{
  // Only one Manufacturing record exists, so nothing about it may be published.
  const res = await fetch(`${base}/api/benchmark/summary?industry=Manufacturing`);
  const s = await res.json();
  check(
    'sub-floor filter publishes nothing',
    res.status === 200 && (s.cohorts ?? []).length === 0 && (s.byIndustry ?? []).length === 0,
    `cohorts=${s.cohorts?.length} byIndustry=${s.byIndustry?.length} published=${s.publishedRecords}`,
  );
}

{
  const res = await fetch(`${base}/api/benchmark/csv`);
  const text = await res.text();
  check('csv 200', res.status === 200, String(res.status));
  check(
    'csv is aggregates only',
    text.includes('metric') && !text.includes('submittedAt'),
    `${text.split('\n').length} lines`,
  );
}

{
  const res = await fetch(`${base}/benchmark`);
  const html = await res.text();
  check('/benchmark renders', res.status === 200 && html.includes('enchmark'), String(res.status));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
