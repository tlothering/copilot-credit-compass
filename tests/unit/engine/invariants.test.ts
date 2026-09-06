import { describe, expect, it } from 'vitest';
import { answersSchema, type Answers } from '@/lib/schemas/answers';
import {
  AI_TOOL_TIERS,
  AUDIENCES,
  AZURE_AGREEMENTS,
  BUDGET_TOLERANCES,
  CONFIDENCE_LEVELS,
  EMPLOYEE_BANDS,
  GITHUB_MODEL_TIERS,
  GITHUB_PLANS,
  INDUSTRIES,
  M365_BASE_PLANS,
  MACC_BANDS,
  RAMP_CURVES,
  REGIONS,
  SEASONALITY_PROFILES,
  SECURITY_COVERAGE,
  SECURITY_DEPLOYMENT,
  VOICE_TIERS,
  WORKLOAD_IDS,
  type WorkloadId,
} from '@/lib/schemas/taxonomy';
import { getRateCard, runEngine } from '@/lib/engine';
import type { EngineResult } from '@/lib/engine/types';

/**
 * Property-based pressure test.
 *
 * The table-driven unit tests pin the maths at hand-calculated points. This suite
 * attacks the space between those points: it generates thousands of *schema-valid*
 * answer sets, runs the whole engine, and asserts the identities that must hold for
 * every possible input. A violation here is a real modelling defect, not a rounding
 * quibble, because each assertion is an accounting identity or a definitional bound.
 */

const CARD = getRateCard();
const EPS = 1e-6;

/** Deterministic PRNG so a failure is always reproducible from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const num = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);
const int = (rng: Rng, lo: number, hi: number) => Math.floor(num(rng, lo, hi + 1));
const bool = (rng: Rng) => rng() < 0.5;

/** A random three-way split that sums to exactly 100. */
function mix100(rng: Rng): [number, number, number] {
  const a = int(rng, 0, 100);
  const b = int(rng, 0, 100 - a);
  return [a, b, 100 - a - b];
}

function usageFor(rng: Rng, id: WorkloadId): Record<string, unknown> {
  const days = int(rng, 1, 31);
  const pct = () => num(rng, 0, 100);
  switch (id) {
    case 'm365-copilot':
      return {
        seatsNow: int(rng, 0, 5000),
        seats12m: int(rng, 0, 50000),
        rampCurve: pick(rng, RAMP_CURVES),
      };
    case 'm365-copilot-chat':
      return {
        users: int(rng, 0, 200000),
        messagesPerUserPerDay: num(rng, 0, 1000),
        businessDaysPerMonth: days,
        generativeSharePct: pct(),
        graphGroundingPct: pct(),
        m365CopilotLicensedPct: pct(),
      };
    case 'copilot-studio-agents': {
      const [c, g, a] = mix100(rng);
      return {
        agentsNow: int(rng, 0, 500),
        agents12m: int(rng, 0, 5000),
        audience: pick(rng, AUDIENCES),
        externalTrafficPct: pct(),
        internalUsers: int(rng, 0, 200000),
        m365CopilotLicensedPct: pct(),
        conversationsPerAgentPerDay: num(rng, 0, 20000),
        turnsPerConversation: num(rng, 0, 500),
        mixClassicPct: c,
        mixGenerativePct: g,
        mixActionPct: a,
        graphGroundingPct: pct(),
        triggersFlows: bool(rng),
        flowActionsPerConversation: num(rng, 0, 1000),
        businessDaysPerMonth: days,
        seasonality: pick(rng, SEASONALITY_PROFILES),
        peakMonthMultiplier: num(rng, 1, 10),
        peakMonth: int(rng, 1, 12),
      };
    }
    case 'copilot-studio-flows':
      return {
        flowRunsPerMonth: num(rng, 0, 5_000_000),
        actionsPerRun: num(rng, 0, 1000),
        m365CopilotLicensedPct: pct(),
      };
    case 'sharepoint-agents':
      return {
        agentCount: int(rng, 0, 5000),
        usersPerAgent: int(rng, 0, 100000),
        messagesPerUserPerDay: num(rng, 0, 1000),
        businessDaysPerMonth: days,
        graphGroundingPct: pct(),
        m365CopilotLicensedPct: pct(),
      };
    case 'voice-agents':
      return {
        callsPerDay: num(rng, 0, 500000),
        avgHandleTimeMinutes: num(rng, 0, 240),
        tier: pick(rng, VOICE_TIERS),
        containmentRatePct: pct(),
        businessDaysPerMonth: days,
      };
    case 'ai-tools':
      return {
        documentsPerMonth: num(rng, 0, 5_000_000),
        pagesPerDocument: num(rng, 0, 10000),
        modelTier: pick(rng, AI_TOOL_TIERS),
        responsesPerMonth: num(rng, 0, 5_000_000),
        tokensPerResponse: num(rng, 0, 1_000_000),
        m365CopilotLicensedPct: pct(),
      };
    case 'd365-agents':
      return {
        users: int(rng, 0, 200000),
        invocationsPerUserPerDay: num(rng, 0, 1000),
        actionsPerInvocation: num(rng, 0, 100),
        businessDaysPerMonth: days,
        m365CopilotLicensedPct: pct(),
      };
    case 'role-based-copilots':
      return {
        users: int(rng, 0, 200000),
        interactionsPerUserPerDay: num(rng, 0, 1000),
        actionsPerInteraction: num(rng, 0, 100),
        businessDaysPerMonth: days,
        m365CopilotLicensedPct: pct(),
      };
    case 'security-copilot':
      return {
        analysts: int(rng, 0, 5000),
        investigationsPerDay: num(rng, 0, 100000),
        scuMinutesPerInvestigation: num(rng, 0, 10000),
        coverage: pick(rng, SECURITY_COVERAGE),
        deployment: pick(rng, SECURITY_DEPLOYMENT),
      };
    case 'github-copilot':
      return {
        seats: int(rng, 0, 100000),
        plan: pick(rng, GITHUB_PLANS),
        heavyUserPct: pct(),
        modelTier: pick(rng, GITHUB_MODEL_TIERS),
      };
    case 'copilot-cowork':
      return {
        users: int(rng, 0, 200000),
        tasksPerUserPerMonth: num(rng, 0, 100000),
        m365CopilotLicensedPct: pct(),
      };
    case 'foundry-byom':
      return {
        agentActionsPerMonth: num(rng, 0, 50_000_000),
        inputTokensPerMonth: num(rng, 0, 1e12),
        outputTokensPerMonth: num(rng, 0, 1e12),
      };
    case 'retrieval-api':
      return { queriesPerMonth: num(rng, 0, 500_000_000) };
  }
}

function randomAnswers(rng: Rng): Answers {
  const workloads = WORKLOAD_IDS.filter(() => rng() < 0.45);
  const usage: Record<string, unknown> = {};
  for (const id of workloads) usage[id] = usageFor(rng, id);

  const raw = {
    profile: {
      industry: pick(rng, INDUSTRIES),
      region: pick(rng, REGIONS),
      employeeBand: pick(rng, EMPLOYEE_BANDS),
      knowledgeWorkers: int(rng, 0, 400000),
      azureAgreement: pick(rng, AZURE_AGREEMENTS),
      maccRemainingBand: rng() < 0.5 ? pick(rng, MACC_BANDS) : undefined,
      maccMonthsRemaining: rng() < 0.5 ? int(rng, 0, 60) : undefined,
      m365Base: pick(rng, M365_BASE_PLANS),
    },
    workloads,
    usage,
    growth: {
      rampMonth1Pct: num(rng, 0, 100),
      rampMonth3Pct: num(rng, 0, 100),
      rampMonth6Pct: num(rng, 0, 100),
      rampMonth12Pct: num(rng, 0, 100),
      confidence: pick(rng, CONFIDENCE_LEVELS),
      budgetTolerance: pick(rng, BUDGET_TOLERANCES),
      costAttributionPerBu: bool(rng),
      canCommitAnnually: bool(rng),
      hasUnspentAzureCommitment: bool(rng),
      commitmentExpiringWithinMonths: rng() < 0.5 ? int(rng, 0, 60) : undefined,
    },
    consent: { contributeToBenchmark: bool(rng), understandsPlanningEstimate: true },
  };

  // Only ever feed the engine input the app itself would accept.
  return answersSchema.parse(raw);
}

/** Every non-finite number in the result tree, with the path that reached it. */
function nonFinitePaths(value: unknown, path = '$', out: string[] = []): string[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path} = ${value}`);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => nonFinitePaths(v, `${path}[${i}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) nonFinitePaths(v, `${path}.${k}`, out);
  }
  return out;
}

function resolvePath(root: unknown, path: string): boolean {
  let cursor: unknown = root;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return false;
    if (!(segment in (cursor as Record<string, unknown>))) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor !== undefined;
}

/** Asserts every identity that must hold regardless of input. Returns failures. */
function annualMsDemand(r: EngineResult): number {
  return r.scenario.expectedMonthlyCredits.reduce((a, b) => a + b, 0);
}

function checkInvariants(r: EngineResult, seed: number): string[] {
  const f: string[] = [];
  const fail = (msg: string) => f.push(`seed ${seed}: ${msg}`);
  const close = (a: number, b: number, tol = EPS) =>
    Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  /** a <= b, tolerant of accumulated floating-point drift at the magnitudes involved. */
  const lte = (a: number, b: number) => a - b <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

  for (const p of nonFinitePaths(r)) fail(`non-finite ${p}`);

  const c = r.credits;
  if (c.grossCredits < -EPS) fail(`negative grossCredits ${c.grossCredits}`);
  if (c.billableCredits < -EPS) fail(`negative billableCredits ${c.billableCredits}`);
  if (c.offsetCredits < -EPS) fail(`negative offsetCredits ${c.offsetCredits}`);
  if (!close(c.grossCredits, c.offsetCredits + c.billableCredits))
    fail(`gross ≠ offset + billable (${c.grossCredits} vs ${c.offsetCredits + c.billableCredits})`);
  if (!close(c.billableCredits, c.internalBillableCredits + c.externalBillableCredits))
    fail(
      `billable ≠ internal + external (${c.billableCredits} vs ${c.internalBillableCredits + c.externalBillableCredits})`,
    );
  if (c.billableCredits > c.grossCredits + EPS) fail('billable exceeds gross');

  /* ---- The two credit meters must never be added together ---------- */
  const msLines = c.lines.filter((l) => l.currency === 'microsoft-copilot-credit');
  const otherLines = c.lines.filter((l) => l.currency !== 'microsoft-copilot-credit');
  if (!close(c.billableCredits, msLines.reduce((a, l) => a + l.billableCredits, 0)))
    fail('billableCredits is not exactly the sum of the Microsoft-meter lines');
  if (!close(c.otherMeterBillableCredits, otherLines.reduce((a, l) => a + l.billableCredits, 0)))
    fail('otherMeterBillableCredits is not exactly the sum of the non-Microsoft lines');
  if (!close(c.byWorkload.reduce((a, w) => a + w.billableCredits, 0), c.billableCredits))
    fail('byWorkload rollup does not reconcile to the Microsoft billable total');
  for (const bucket of c.byCurrency) {
    const unit = CARD.creditCurrencies[bucket.currency]?.unitUsd;
    if (typeof unit !== 'number') fail(`currency ${bucket.currency} has no numeric unit price`);
    else if (!close(bucket.billableCostUsd, bucket.billableCredits * unit))
      fail(`currency ${bucket.currency} cost ≠ credits × unit price`);
    if (bucket.currency !== 'microsoft-copilot-credit' && bucket.fundableBy.length > 0)
      fail(`currency ${bucket.currency} claims a Microsoft funding vehicle can pay for it`);
  }
  // No funding option may claim to fund a meter it cannot reach, and the unfundable
  // spend must be identical everywhere so it can never tip the recommendation.
  const unfundable = r.cost.platformLines
    .filter((l) => l.id.startsWith('other-meter-'))
    .reduce((a, l) => a + l.annualUsd, 0);
  for (const o of r.fundingOptions) {
    for (const cur of o.fundsCurrencies) {
      if (!CARD.creditCurrencies[cur]?.fundableBy.includes(o.id))
        fail(`option ${o.id} claims to fund ${cur}, which the rate card does not permit`);
    }
    if (o.twelveMonthTotalUsd < unfundable - EPS * Math.max(1, unfundable))
      fail(`option ${o.id} total ${o.twelveMonthTotalUsd} is below the unfundable floor ${unfundable}`);
    if (o.purchasedCredits > 0 && c.billableCredits <= 0 && annualMsDemand(r) <= 0)
      fail(`option ${o.id} buys ${o.purchasedCredits} credits against zero Microsoft demand`);
  }

  const cost = r.cost;
  if (cost.totalMonthlyUsd < -EPS) fail(`negative totalMonthlyUsd ${cost.totalMonthlyUsd}`);
  if (!close(cost.totalMonthlyUsd, cost.meteredCreditCostUsd + cost.platformMonthlyUsd))
    fail('totalMonthlyUsd ≠ metered + platform');
  if (!close(cost.platformAnnualUsd, cost.platformMonthlyUsd * 12))
    fail('platformAnnualUsd ≠ platformMonthlyUsd × 12');
  for (const line of cost.platformLines) {
    if (line.monthlyUsd < -EPS) fail(`negative platform line ${line.id}`);
    if (!close(line.annualUsd, line.monthlyUsd * 12)) fail(`platform line ${line.id} annual ≠ ×12`);
  }

  const s = r.scenario;
  const n = s.expectedMonthlyCredits.length;
  if (n !== 12) fail(`expected 12 projection months, got ${n}`);
  if (s.conservativeMonthlyCredits.length !== n || s.aggressiveMonthlyCredits.length !== n)
    fail('scenario band arrays are ragged');
  for (let i = 0; i < n; i += 1) {
    const lo = s.conservativeMonthlyCredits[i]!;
    const mid = s.expectedMonthlyCredits[i]!;
    const hi = s.aggressiveMonthlyCredits[i]!;
    if (lo < -EPS || mid < -EPS || hi < -EPS) fail(`negative projected credits at month ${i + 1}`);
    if (lo > mid + EPS) fail(`conservative > expected at month ${i + 1} (${lo} > ${mid})`);
    if (mid > hi + EPS) fail(`expected > aggressive at month ${i + 1} (${mid} > ${hi})`);
  }
  if (s.bands.conservative.monthlyCredits > s.bands.expected.monthlyCredits + EPS)
    fail('conservative band above expected band');
  if (s.bands.expected.monthlyCredits > s.bands.aggressive.monthlyCredits + EPS)
    fail('expected band above aggressive band');

  const b = r.licenceBreakEven;
  if (b.shareOfUsersAboveBreakEvenPct < -EPS || b.shareOfUsersAboveBreakEvenPct > 100 + EPS)
    fail(`share above break-even out of range: ${b.shareOfUsersAboveBreakEvenPct}`);
  if (b.usersAboveBreakEven > b.unlicensedInternalUsers)
    fail('more users above break-even than unlicensed users exist');
  if (b.licensedInternalUsers + b.unlicensedInternalUsers > b.internalUsers + 1)
    fail('licensed + unlicensed exceeds internal users');
  if (b.creditsRemovedByTargetedShift < -EPS) fail('negative credits removed');
  if (!lte(b.creditsRemovedByTargetedShift, c.offsettableRemainingCredits)) {
    const rel =
      (b.creditsRemovedByTargetedShift - c.offsettableRemainingCredits) /
      Math.max(1, c.offsettableRemainingCredits);
    fail(
      `targeted shift removes more credits than are offsettable: ${b.creditsRemovedByTargetedShift} > ${c.offsettableRemainingCredits} (relative ${rel.toExponential(3)})`,
    );
  }
  if (!close(b.annualNetBenefitUsd, b.annualMeteredSpendRemovedUsd - b.annualSeatCostUsd))
    fail('net benefit ≠ removed − seat cost');
  if (b.worthwhile && b.annualNetBenefitUsd <= 0) fail('worthwhile with non-positive net benefit');

  if (r.fundingOptions.length !== 8) fail(`expected 8 funding options, got ${r.fundingOptions.length}`);
  if (new Set(r.fundingOptions.map((o) => o.id)).size !== r.fundingOptions.length)
    fail('duplicate funding option ids');
  for (const o of r.fundingOptions) {
    if (o.twelveMonthTotalUsd < -EPS) fail(`negative 12m total for ${o.id}`);
    if (o.purchasedCredits < -EPS) fail(`negative purchasedCredits for ${o.id}`);
    if (o.wasteCredits < -EPS) fail(`negative wasteCredits for ${o.id}`);
    if (o.shortfallCredits < -EPS) fail(`negative shortfallCredits for ${o.id}`);
    if (o.shortfallRiskPct < -EPS || o.shortfallRiskPct > 100 + EPS)
      fail(`shortfallRiskPct out of range for ${o.id}: ${o.shortfallRiskPct}`);
    if (!close(o.twelveMonthTotalUsd, o.creditFundingUsd + o.platformCostUsd))
      fail(`12m total ≠ credit funding + platform for ${o.id}`);
    if (!o.eligible && o.ineligibleReasons.length === 0)
      fail(`${o.id} is ineligible with no stated reason`);
  }

  const ids = new Set(r.fundingOptions.map((o) => o.id));
  if (!ids.has(r.recommendation.primary.optionId))
    fail(`recommendation points at unknown option ${r.recommendation.primary.optionId}`);
  const primary = r.fundingOptions.find((o) => o.id === r.recommendation.primary.optionId)!;
  if (!primary.eligible) fail(`recommended option ${primary.id} is marked ineligible`);

  for (const entry of r.audit) {
    if (!entry.step) fail('audit entry with no step');
    if (!entry.formula) fail(`audit entry ${entry.step} has no formula`);
    if (entry.rateCardRef && !resolvePath(CARD, entry.rateCardRef))
      fail(`audit entry ${entry.step} references a rate-card path that does not exist: ${entry.rateCardRef}`);
  }

  return f;
}

/**
 * Scenario count for the committed suite. The full engine including the sensitivity
 * sweep costs about 20ms per scenario, so this is sized to stay under a minute. Set
 * INVARIANT_SCENARIOS higher to sweep the space harder when investigating.
 */
const SCENARIOS = Number(process.env.INVARIANT_SCENARIOS ?? 800);

describe('engine invariants under randomised input', () => {
  it(
    `holds every accounting identity across ${SCENARIOS.toLocaleString('en-GB')} random scenarios`,
    { timeout: 120_000 },
    () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= SCENARIOS; seed += 1) {
        const answers = randomAnswers(mulberry32(seed));
        failures.push(...checkInvariants(runEngine(answers, CARD), seed));
        if (failures.length > 40) break;
      }
      expect(failures.slice(0, 40)).toEqual([]);
    },
  );

  it('is deterministic — identical answers produce byte-identical results', () => {
    for (let seed = 5000; seed < 5025; seed += 1) {
      const answers = randomAnswers(mulberry32(seed));
      expect(JSON.stringify(runEngine(answers, CARD))).toEqual(
        JSON.stringify(runEngine(structuredClone(answers), CARD)),
      );
    }
  });

  it('never decreases billable credits when a volume driver increases', () => {
    const failures: string[] = [];
    for (let seed = 9000; seed < 9200; seed += 1) {
      const base = randomAnswers(mulberry32(seed));
      const chat = base.usage['m365-copilot-chat'];
      if (!chat || chat.users === 0 || chat.messagesPerUserPerDay === 0) continue;

      const more = answersSchema.parse({
        ...base,
        usage: {
          ...base.usage,
          'm365-copilot-chat': {
            ...chat,
            messagesPerUserPerDay: Math.min(1000, chat.messagesPerUserPerDay * 2),
          },
        },
      });
      const a = runEngine(base, CARD).credits.billableCredits;
      const b = runEngine(more, CARD).credits.billableCredits;
      if (b < a - EPS * Math.max(1, a)) {
        failures.push(`seed ${seed}: doubling chat messages reduced billable credits ${a} → ${b}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('produces a complete, self-consistent result for the extremes of the input space', () => {
    const everyWorkload = [...WORKLOAD_IDS];
    const cases: Array<[string, Answers]> = [];

    // Floor: every workload selected, every driver at zero.
    const zeroUsage: Record<string, unknown> = {};
    for (const id of everyWorkload) {
      const rng = mulberry32(1);
      const u = usageFor(rng, id) as Record<string, unknown>;
      for (const [k, v] of Object.entries(u)) if (typeof v === 'number') u[k] = 0;
      // Fields with a positive lower bound cannot be zeroed.
      if ('businessDaysPerMonth' in u) u.businessDaysPerMonth = 1;
      if ('peakMonthMultiplier' in u) u.peakMonthMultiplier = 1;
      if ('peakMonth' in u) u.peakMonth = 1;
      if ('mixClassicPct' in u) {
        u.mixClassicPct = 100;
        u.mixGenerativePct = 0;
        u.mixActionPct = 0;
      }
      zeroUsage[id] = u;
    }
    cases.push([
      'every workload at zero volume',
      answersSchema.parse({
        profile: {
          industry: 'Other',
          region: 'Northern America',
          employeeBand: '1-50',
          knowledgeWorkers: 0,
          azureAgreement: 'none',
          m365Base: 'E3',
        },
        workloads: everyWorkload,
        usage: zeroUsage,
        growth: {
          rampMonth1Pct: 0,
          rampMonth3Pct: 0,
          rampMonth6Pct: 0,
          rampMonth12Pct: 0,
          confidence: 'low',
          budgetTolerance: 'never',
          costAttributionPerBu: false,
          canCommitAnnually: false,
          hasUnspentAzureCommitment: false,
        },
        consent: { contributeToBenchmark: false, understandsPlanningEstimate: true },
      }),
    ]);

    // Ceiling: every workload selected, every driver at its schema maximum.
    const maxUsage: Record<string, unknown> = {
      'm365-copilot': { seatsNow: 5_000_000, seats12m: 5_000_000, rampCurve: 'big-bang' },
      'm365-copilot-chat': {
        users: 5_000_000,
        messagesPerUserPerDay: 1000,
        businessDaysPerMonth: 31,
        generativeSharePct: 100,
        graphGroundingPct: 100,
        m365CopilotLicensedPct: 0,
      },
      'copilot-studio-agents': {
        agentsNow: 100_000,
        agents12m: 100_000,
        audience: 'external',
        externalTrafficPct: 100,
        internalUsers: 5_000_000,
        m365CopilotLicensedPct: 0,
        conversationsPerAgentPerDay: 1_000_000,
        turnsPerConversation: 500,
        mixClassicPct: 0,
        mixGenerativePct: 100,
        mixActionPct: 0,
        graphGroundingPct: 100,
        triggersFlows: true,
        flowActionsPerConversation: 1000,
        businessDaysPerMonth: 31,
        seasonality: 'seasonal-spike',
        peakMonthMultiplier: 10,
        peakMonth: 12,
      },
      'copilot-studio-flows': {
        flowRunsPerMonth: 100_000_000,
        actionsPerRun: 1000,
        m365CopilotLicensedPct: 0,
      },
      'sharepoint-agents': {
        agentCount: 100_000,
        usersPerAgent: 1_000_000,
        messagesPerUserPerDay: 1000,
        businessDaysPerMonth: 31,
        graphGroundingPct: 100,
        m365CopilotLicensedPct: 0,
      },
      'voice-agents': {
        callsPerDay: 10_000_000,
        avgHandleTimeMinutes: 240,
        tier: 'genai',
        containmentRatePct: 0,
        businessDaysPerMonth: 31,
      },
      'ai-tools': {
        documentsPerMonth: 100_000_000,
        pagesPerDocument: 10_000,
        modelTier: 'premium',
        responsesPerMonth: 100_000_000,
        tokensPerResponse: 1_000_000,
        m365CopilotLicensedPct: 0,
      },
      'd365-agents': {
        users: 5_000_000,
        invocationsPerUserPerDay: 1000,
        actionsPerInvocation: 100,
        businessDaysPerMonth: 31,
        m365CopilotLicensedPct: 0,
      },
      'role-based-copilots': {
        users: 5_000_000,
        interactionsPerUserPerDay: 1000,
        actionsPerInteraction: 100,
        businessDaysPerMonth: 31,
        m365CopilotLicensedPct: 0,
      },
      'security-copilot': {
        analysts: 100_000,
        investigationsPerDay: 1_000_000,
        scuMinutesPerInvestigation: 10_000,
        coverage: '24x7',
        deployment: 'both',
      },
      'github-copilot': {
        seats: 1_000_000,
        plan: 'enterprise',
        heavyUserPct: 100,
        modelTier: 'premium',
      },
      'copilot-cowork': {
        users: 5_000_000,
        tasksPerUserPerMonth: 100_000,
        m365CopilotLicensedPct: 0,
      },
      'foundry-byom': {
        agentActionsPerMonth: 1_000_000_000,
        inputTokensPerMonth: 1e15,
        outputTokensPerMonth: 1e15,
      },
      'retrieval-api': { queriesPerMonth: 1_000_000_000 },
    };
    cases.push([
      'every workload at its schema ceiling',
      answersSchema.parse({
        profile: {
          industry: 'Technology & Software',
          region: 'Northern America',
          employeeBand: '100k+',
          knowledgeWorkers: 5_000_000,
          azureAgreement: 'macc',
          maccRemainingBand: '5m+',
          maccMonthsRemaining: 60,
          m365Base: 'E5',
        },
        workloads: everyWorkload,
        usage: maxUsage,
        growth: {
          rampMonth1Pct: 100,
          rampMonth3Pct: 100,
          rampMonth6Pct: 100,
          rampMonth12Pct: 100,
          confidence: 'high',
          budgetTolerance: 'irrelevant',
          costAttributionPerBu: true,
          canCommitAnnually: true,
          hasUnspentAzureCommitment: true,
          commitmentExpiringWithinMonths: 60,
        },
        consent: { contributeToBenchmark: true, understandsPlanningEstimate: true },
      }),
    ]);

    // Nothing selected at all — the state the wizard actually starts in.
    cases.push([
      'no workloads selected',
      answersSchema.parse({
        profile: {
          industry: 'Other',
          region: 'Northern America',
          employeeBand: '1k-5k',
          knowledgeWorkers: 1000,
          azureAgreement: 'none',
          m365Base: 'E3',
        },
        workloads: [],
        usage: {},
        growth: {
          rampMonth1Pct: 15,
          rampMonth3Pct: 40,
          rampMonth6Pct: 70,
          rampMonth12Pct: 100,
          confidence: 'medium',
          budgetTolerance: 'tolerable',
          costAttributionPerBu: false,
          canCommitAnnually: false,
          hasUnspentAzureCommitment: false,
        },
        consent: { contributeToBenchmark: false, understandsPlanningEstimate: true },
      }),
    ]);

    const failures: string[] = [];
    for (const [name, answers] of cases) {
      const result = runEngine(answers, CARD);
      failures.push(...checkInvariants(result, 0).map((m) => `${name}: ${m.replace('seed 0: ', '')}`));
    }
    expect(failures).toEqual([]);
  });
});
