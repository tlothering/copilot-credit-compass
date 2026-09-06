import { describe, expect, it } from 'vitest';
import type { FundingInput } from '@/lib/engine/funding-options';
import { buildFundingOptions } from '@/lib/engine/funding-options';
import { buildCreditModel } from '@/lib/engine/credit-model';
import { buildCostModel } from '@/lib/engine/cost-model';
import { buildVolumeModel } from '@/lib/engine/volume-model';
import { buildScenarioModel } from '@/lib/engine/scenario-band';
import { buildLicenceBreakEven } from '@/lib/engine/licence-break-even';
import { normalise } from '@/lib/engine/normalise';
import { percentile, sum } from '@/lib/engine/util';
import type { FundingOption, FundingOptionId } from '@/lib/engine/types';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { answersWith, audit, card, flatAnswers, near } from './fixtures';

const ALL_IDS: FundingOptionId[] = [
  'payg',
  'packs-only',
  'packs-plus-payg',
  'p3-plus-payg',
  'p3-packs-payg',
  'licence-shift',
  'byom-foundry',
  'do-nothing',
];

interface Harness {
  options: FundingOption[];
  byId: (id: FundingOptionId) => FundingOption;
  input: FundingInput;
  trail: ReturnType<typeof audit>;
}

function fund(
  workloads: WorkloadId[],
  usageOverrides: Partial<Record<WorkloadId, Record<string, unknown>>> = {},
  patch: Parameters<typeof answersWith>[2] = {},
  flat = false,
  tweak: Partial<Pick<
    FundingInput,
    'licenceShiftMonthlyCredits' | 'licenceShiftAdditionalSeats' | 'byomMonthlyCredits' | 'byomAnnualTokenCostUsd'
  >> = {},
): Harness {
  const trail = audit();
  const answers = flat
    ? flatAnswers(workloads, usageOverrides, patch)
    : answersWith(workloads, usageOverrides, patch);
  const normalised = normalise(answers, trail);
  const volume = buildVolumeModel(normalised, card, trail);
  const credits = buildCreditModel(volume, card, trail);
  const cost = buildCostModel(credits, normalised, card, trail);
  const scenario = buildScenarioModel(credits, normalised, card, trail);
  const licenceBreakEven = buildLicenceBreakEven(credits, normalised, card, trail);

  const input: FundingInput = {
    card,
    normalised,
    credits,
    cost,
    scenario,
    licenceBreakEven,
    licenceShiftMonthlyCredits: scenario.expectedMonthlyCredits.map((c) => c * 0.4),
    licenceShiftAdditionalSeats: licenceBreakEven.usersAboveBreakEven,
    byomMonthlyCredits: scenario.expectedMonthlyCredits.map((c) => c * 0.6),
    byomAnnualTokenCostUsd: 5_000,
    ...tweak,
  };

  const options = buildFundingOptions(input, trail);
  return {
    options,
    input,
    trail,
    byId: (id) => {
      const found = options.find((o) => o.id === id);
      if (!found) throw new Error(`missing funding option ${id}`);
      return found;
    },
  };
}

const BASE: WorkloadId[] = ['m365-copilot-chat', 'copilot-studio-agents'];

describe('the complete option set (SPEC §6.5)', () => {
  it('always returns all eight options in a stable order', () => {
    expect(fund(BASE).options.map((o) => o.id)).toEqual(ALL_IDS);
  });

  it('returns all eight even when no workloads are selected', () => {
    expect(fund([]).options.map((o) => o.id)).toEqual(ALL_IDS);
  });

  it('gives every option the fields the comparison table needs', () => {
    for (const o of fund(BASE).options) {
      expect(o.label.length, o.id).toBeGreaterThan(0);
      expect(o.summary.length, o.id).toBeGreaterThan(0);
      expect(o.bestWhen.length, o.id).toBeGreaterThan(0);
      expect(o.avoidWhen.length, o.id).toBeGreaterThan(0);
      expect(o.breakdown.length, o.id).toBeGreaterThan(0);
      expect(o.monthlyUsd, o.id).toHaveLength(12);
      expect(Number.isFinite(o.twelveMonthTotalUsd), o.id).toBe(true);
      expect(Number.isFinite(o.peakMonthUsd), o.id).toBe(true);
      expect(Number.isFinite(o.effectiveUsdPerCredit), o.id).toBe(true);
    }
  });

  it('computes twelveMonthTotal as credit funding plus platform cost', () => {
    for (const o of fund(BASE).options) {
      expect(near(o.twelveMonthTotalUsd), o.id).toBe(
        near(o.creditFundingUsd + o.platformCostUsd),
      );
    }
  });

  it('computes peakMonthUsd as the worst month of credit + platform spend', () => {
    for (const o of fund(BASE).options) {
      expect(near(o.peakMonthUsd), o.id).toBe(near(Math.max(...o.monthlyUsd)));
    }
  });

  it('records one audit entry per option', () => {
    const { trail } = fund(BASE);
    for (const id of ALL_IDS) {
      const entry = trail.entries.find((e) => e.step === `funding:${id}`);
      expect(entry, id).toBeDefined();
      expect(entry?.outputUnit).toBe('USD over 12 months');
    }
  });

  it('references the P3 tier table only for the pre-purchase options', () => {
    const { trail } = fund(BASE);
    const ref = (id: string) => trail.entries.find((e) => e.step === `funding:${id}`)?.rateCardRef;
    expect(ref('p3-plus-payg')).toBe('p3PrePurchasePlan.tiers');
    expect(ref('p3-packs-payg')).toBe('p3PrePurchasePlan.tiers');
    expect(ref('payg')).toBe('commercial');
  });
});

describe('1. pay-as-you-go', () => {
  it('is demand × the meter price with no prepayment', () => {
    const h = fund(BASE);
    const o = h.byId('payg');
    expect(near(o.creditFundingUsd)).toBe(near(sum(h.input.scenario.expectedMonthlyCredits) * 0.01));
    expect(o.purchasedCredits).toBe(0);
    expect(o.wasteCredits).toBe(0);
    expect(o.shortfallCredits).toBe(0);
    expect(o.commitmentLockInMonths).toBe(0);
    expect(o.reversibility).toBe('immediate');
    expect(o.cashFlowShape).toBe('monthly-variable');
    expect(o.eligible).toBe(true);
  });

  it('has an effective rate of exactly the pay-as-you-go price', () => {
    expect(near(fund(BASE).byId('payg').effectiveUsdPerCredit)).toBe(0.01);
  });
});

describe('2. capacity packs only', () => {
  it('sizes packs at the configured percentile of monthly demand', () => {
    const h = fund(BASE);
    const o = h.byId('packs-only');
    const pct = o.meta?.sizingPercentile as number;
    const target = percentile(h.input.scenario.expectedMonthlyCredits, pct);
    expect(o.meta?.packCount).toBe(Math.max(1, Math.ceil(target / 25000)));
    expect(o.meta?.capacityPerMonth).toBe((o.meta?.packCount as number) * 25000);
  });

  it('drops to the volatile percentile when demand is choppy', () => {
    const volatile = fund(BASE).byId('packs-only');
    const steady = fund(BASE, {}, {}, true).byId('packs-only');
    expect(volatile.meta?.sizingPercentile).toBe(
      card.modelAssumptions.packSizingPercentileWhenVolatile,
    );
    expect(steady.meta?.sizingPercentile).toBe(card.modelAssumptions.packSizingPercentile);
  });

  it('buys at least one pack even with negligible demand', () => {
    const tiny = fund(['retrieval-api'], { 'retrieval-api': { queriesPerMonth: 1 } });
    expect(tiny.byId('packs-only').meta?.packCount).toBe(1);
  });

  it('buys no packs at all when there is no demand to serve', () => {
    // Reachable for a GitHub-only estate: a real bill, but none of it on the
    // Microsoft meter. Quoting a capacity pack there is quoting for dead capacity.
    const o = fund([]).byId('packs-only');
    expect(o.meta?.packCount).toBe(0);
    expect(o.purchasedCredits).toBe(0);
    expect(o.creditFundingUsd).toBe(0);
  });

  it('is a fixed monthly cost that never varies', () => {
    const o = fund(BASE).byId('packs-only');
    expect(o.cashFlowShape).toBe('monthly-fixed');
    expect(new Set(o.monthlyUsd.map(near)).size).toBe(1);
  });

  it('is ruled ineligible when a hard-stop customer would still lose a big slice of the year', () => {
    const o = fund(BASE, {}, { growth: { budgetTolerance: 'never' } }).byId('packs-only');
    expect(o.shortfallCredits).toBeGreaterThan(0);
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('would simply fail');
  });

  it('is ruled ineligible when the org tolerates an overage', () => {
    const o = fund(BASE, {}, { growth: { budgetTolerance: 'tolerable' } }).byId('packs-only');
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('overage is acceptable');
  });

  it('can be eligible for a flat estate that never tolerates an overage', () => {
    const o = fund([], {}, { growth: { budgetTolerance: 'never' } }, true).byId('packs-only');
    expect(o.shortfallCredits).toBe(0);
    expect(o.eligible).toBe(true);
    expect(o.ineligibleReasons).toEqual([]);
  });

  it('reports waste as a percentage of purchased capacity', () => {
    // Needs a flat estate that is small enough to leave a pack mostly idle.
    const o = fund(['retrieval-api'], { 'retrieval-api': { queriesPerMonth: 100 } }, {}, true).byId(
      'packs-only',
    );
    expect(o.purchasedCredits).toBeGreaterThan(0);
    expect(o.wastePctOfPurchased).toBeGreaterThan(0);
    expect(near(o.wastePctOfPurchased)).toBe(near((o.wasteCredits / o.purchasedCredits) * 100));
  });

  it('reports shortfall as a percentage of total demand', () => {
    const o = fund(BASE).byId('packs-only');
    const total = o.creditsServed + o.shortfallCredits;
    expect(near(o.shortfallRiskPct)).toBe(near((o.shortfallCredits / total) * 100));
  });
});

describe('3. packs + pay-as-you-go overage', () => {
  it('never leaves a shortfall', () => {
    const o = fund(BASE).byId('packs-plus-payg');
    expect(o.shortfallCredits).toBe(0);
    expect(o.shortfallRiskPct).toBe(0);
    expect(o.eligible).toBe(true);
  });

  it('serves the whole of expected demand', () => {
    const h = fund(BASE);
    expect(near(h.byId('packs-plus-payg').creditsServed)).toBe(
      near(sum(h.input.scenario.expectedMonthlyCredits)),
    );
  });

  it('costs at least the packs-only price and buys the same capacity', () => {
    const h = fund(BASE);
    const packs = h.byId('packs-only');
    const hybrid = h.byId('packs-plus-payg');
    expect(hybrid.meta?.capacityPerMonth).toBe(packs.meta?.capacityPerMonth);
    expect(hybrid.creditFundingUsd).toBeGreaterThanOrEqual(packs.creditFundingUsd - 1e-6);
  });

  it('prices overage credits at the meter rate', () => {
    const h = fund(BASE);
    const o = h.byId('packs-plus-payg');
    const overage = o.meta?.overageCredits as number;
    const row = o.breakdown.find((b) => b.label === 'Pay-as-you-go overage');
    expect(near(row!.annualUsd)).toBe(near(overage * 0.01));
  });

  it('notes when the pack was deliberately under-sized for volatility', () => {
    const o = fund(BASE).byId('packs-plus-payg');
    expect(o.breakdown[0]?.note).toContain('volatile');
  });
});

describe('4. P3 pre-purchase + pay-as-you-go', () => {
  it('sizes the commitment on the conservative band, never the expected band', () => {
    const h = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'high' } });
    const o = h.byId('p3-plus-payg');
    const conservativeRetail = sum(h.input.scenario.conservativeMonthlyCredits) * 0.01;
    expect(near(o.meta?.commitUnits as number)).toBe(near(conservativeRetail));
  });

  it('applies the tier discount from the rate-card ladder', () => {
    const h = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'high' } });
    const o = h.byId('p3-plus-payg');
    const commit = o.meta?.commitUnits as number;
    const discount = o.meta?.discountPct as number;
    const tiers = card.p3PrePurchasePlan.tiers;
    const expectedTier = [...tiers].reverse().find((t) => commit >= t.commitUnits);
    expect(discount).toBe(expectedTier?.discountPct);
    expect(near(o.breakdown[0]!.annualUsd)).toBe(near(commit * (1 - discount / 100)));
  });

  it('meters everything above the commitment at full retail', () => {
    const h = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'high' } });
    const o = h.byId('p3-plus-payg');
    const expectedRetail = sum(h.input.scenario.expectedMonthlyCredits) * 0.01;
    const commit = o.meta?.commitUnits as number;
    expect(near(o.breakdown[1]!.annualUsd)).toBe(near(Math.max(0, expectedRetail - commit)));
  });

  it('beats straight pay-as-you-go whenever a tier is reached', () => {
    const h = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'high' } });
    const p3 = h.byId('p3-plus-payg');
    if ((p3.meta?.discountPct as number) > 0) {
      expect(p3.creditFundingUsd).toBeLessThan(h.byId('payg').creditFundingUsd);
    }
  });

  it('carries an annual-upfront cash-flow shape and the rate-card term', () => {
    const o = fund(BASE).byId('p3-plus-payg');
    expect(o.cashFlowShape).toBe('annual-upfront');
    expect(o.commitmentLockInMonths).toBe(card.p3PrePurchasePlan.termMonths);
    expect(o.reversibility).toBe('annual-locked');
  });

  it('is ineligible when the org cannot commit annually', () => {
    const o = fund(BASE, {}, { growth: { canCommitAnnually: false } }).byId('p3-plus-payg');
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('cannot make an annual commitment');
  });

  it('is ineligible when forecast confidence is low', () => {
    const o = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'low' } }).byId(
      'p3-plus-payg',
    );
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('confidence is low');
  });

  it('is ineligible when spend never reaches the smallest tier', () => {
    const o = fund([], {}, { growth: { canCommitAnnually: true, confidence: 'high' } }).byId(
      'p3-plus-payg',
    );
    expect(o.meta?.commitUnits).toBe(0);
    expect(o.meta?.discountPct).toBe(0);
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('smallest published pre-purchase tier');
  });

  it('is eligible for a confident, committable, large estate', () => {
    const o = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'high' } }).byId(
      'p3-plus-payg',
    );
    expect(o.eligible).toBe(true);
    expect(o.ineligibleReasons).toEqual([]);
  });

  it('evaluates every published tier', () => {
    expect(fund(BASE).byId('p3-plus-payg').meta?.tiersEvaluated).toBe(
      card.p3PrePurchasePlan.tiers.length,
    );
  });
});

describe('5. P3 + packs + pay-as-you-go waterfall', () => {
  it('layers packs under the commitment under the meter', () => {
    const o = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'high' } }).byId(
      'p3-packs-payg',
    );
    expect(o.breakdown.map((b) => b.label.replace(/^\d+ × /, '').split(' ')[0])).toEqual([
      'capacity',
      'P3',
      'Pay-as-you-go',
      'Platform',
    ]);
    expect(o.cashFlowShape).toBe('hybrid');
  });

  it('sizes the commitment only on the residual above pack capacity', () => {
    const h = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'high' } });
    const plain = h.byId('p3-plus-payg');
    const layered = h.byId('p3-packs-payg');
    expect(layered.meta?.commitUnits as number).toBeLessThan(plain.meta?.commitUnits as number);
  });

  it('counts both pack waste and unused commitment as waste', () => {
    const o = fund(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'high' } }).byId(
      'p3-packs-payg',
    );
    expect(o.wasteCredits).toBeGreaterThan(0);
    expect(o.purchasedCredits).toBeGreaterThan(0);
  });

  it('serves all expected demand with no shortfall', () => {
    const h = fund(BASE);
    const o = h.byId('p3-packs-payg');
    expect(o.shortfallCredits).toBe(0);
    expect(near(o.creditsServed)).toBe(near(sum(h.input.scenario.expectedMonthlyCredits)));
  });

  it('shares the P3 eligibility rules', () => {
    const o = fund(BASE, {}, { growth: { canCommitAnnually: false } }).byId('p3-packs-payg');
    expect(o.eligible).toBe(false);
  });
});

describe('6. licence shift', () => {
  it('adds seat cost to the platform line, not the credit line', () => {
    const h = fund(BASE, {}, {}, false, { licenceShiftAdditionalSeats: 100 });
    const o = h.byId('licence-shift');
    expect(near(o.platformCostUsd)).toBe(near(h.input.cost.platformAnnualUsd + 100 * 30 * 12));
    expect(near(o.creditFundingUsd)).toBe(near(sum(h.input.licenceShiftMonthlyCredits) * 0.01));
  });

  it('meters only the residual traffic the licence cannot cover', () => {
    const h = fund(BASE);
    expect(h.byId('licence-shift').creditsServed).toBeLessThan(h.byId('payg').creditsServed);
  });

  it('locks in for twelve months and is not reversible mid-term', () => {
    const o = fund(BASE).byId('licence-shift');
    expect(o.commitmentLockInMonths).toBe(12);
    expect(o.reversibility).toBe('annual-locked');
  });

  it('is ineligible when everyone already holds a licence', () => {
    const o = fund(BASE, {}, {}, false, { licenceShiftAdditionalSeats: 0 }).byId('licence-shift');
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('no shift left to make');
  });

  it('is ineligible when per-user consumption sits below break-even', () => {
    const o = fund(
      ['m365-copilot-chat'],
      { 'm365-copilot-chat': { users: 5000, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 1, generativeSharePct: 0, graphGroundingPct: 0 } },
      { profile: { knowledgeWorkers: 5000 } },
      false,
      { licenceShiftAdditionalSeats: 50 },
    ).byId('licence-shift');
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('costs more than it removes');
  });

  it('exposes the break-even threshold in its metadata for the UI', () => {
    const o = fund(BASE).byId('licence-shift');
    expect(o.meta?.breakEvenCredits).toBe(3000);
  });
});

describe('7. bring your own model (Azure AI Foundry)', () => {
  it('puts token spend on the platform line and the remainder on the meter', () => {
    const h = fund(BASE);
    const o = h.byId('byom-foundry');
    expect(near(o.platformCostUsd)).toBe(near(h.input.cost.platformAnnualUsd + 5000));
    expect(near(o.creditFundingUsd)).toBe(near(sum(h.input.byomMonthlyCredits) * 0.01));
  });

  it('is fully reversible with no lock-in', () => {
    const o = fund(BASE).byId('byom-foundry');
    expect(o.commitmentLockInMonths).toBe(0);
    expect(o.reversibility).toBe('immediate');
  });

  it('is ineligible when no workload produces model responses', () => {
    const o = fund(BASE, {}, {}, false, { byomAnnualTokenCostUsd: 0 }).byId('byom-foundry');
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('could be served from your own Foundry');
  });

  it('is ineligible when per-business-unit attribution is required', () => {
    const o = fund(BASE, {}, { growth: { costAttributionPerBu: true } }).byId('byom-foundry');
    expect(o.eligible).toBe(false);
    expect(o.ineligibleReasons.join(' ')).toContain('attribution harder');
  });

  it('is eligible for a high-volume org that does not need BU attribution', () => {
    const o = fund(BASE, {}, { growth: { costAttributionPerBu: false } }).byId('byom-foundry');
    expect(o.eligible).toBe(true);
  });

  it('reports how many credits the swap removes', () => {
    const o = fund(BASE).byId('byom-foundry');
    expect(o.meta?.generativeCreditsRemoved as number).toBeGreaterThan(0);
  });
});

describe('8. do nothing', () => {
  it('costs nothing and serves nothing', () => {
    const o = fund(BASE).byId('do-nothing');
    expect(o.twelveMonthTotalUsd).toBe(0);
    expect(o.creditFundingUsd).toBe(0);
    expect(o.platformCostUsd).toBe(0);
    expect(o.creditsServed).toBe(0);
    expect(o.peakMonthUsd).toBe(0);
  });

  it('books the entire forecast as unserved demand', () => {
    const h = fund(BASE);
    const o = h.byId('do-nothing');
    expect(near(o.shortfallCredits)).toBe(near(sum(h.input.scenario.expectedMonthlyCredits)));
    expect(near(o.shortfallRiskPct)).toBe(100);
  });

  it('is deliberately kept on the table as an eligible baseline', () => {
    const o = fund(BASE).byId('do-nothing');
    expect(o.eligible).toBe(true);
    expect(o.maccEligibility).toBe('no');
    expect(o.reversibility).toBe('n/a');
  });

  it('has no shortfall at all when nothing was going to be consumed', () => {
    const o = fund([]).byId('do-nothing');
    expect(o.shortfallCredits).toBe(0);
    expect(o.shortfallRiskPct).toBe(0);
  });
});

describe('MACC eligibility comes from the rate card', () => {
  it('maps each instrument to its published eligibility', () => {
    const h = fund(BASE);
    expect(h.byId('payg').maccEligibility).toBe(card.maccEligibility.paygCredits);
    expect(h.byId('packs-only').maccEligibility).toBe(card.maccEligibility.capacityPacks);
    expect(h.byId('p3-plus-payg').maccEligibility).toBe(card.maccEligibility.p3PrePurchase);
    expect(h.byId('licence-shift').maccEligibility).toBe(card.maccEligibility.m365CopilotSeats);
    expect(h.byId('byom-foundry').maccEligibility).toBe(card.maccEligibility.foundryTokens);
  });
});
