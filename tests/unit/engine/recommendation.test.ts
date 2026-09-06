import { describe, expect, it } from 'vitest';
import { buildRecommendation, effectiveRateFor } from '@/lib/engine/recommendation';
import type { FundingInput } from '@/lib/engine/funding-options';
import { buildFundingOptions } from '@/lib/engine/funding-options';
import { buildCreditModel } from '@/lib/engine/credit-model';
import { buildCostModel } from '@/lib/engine/cost-model';
import { buildVolumeModel } from '@/lib/engine/volume-model';
import { buildScenarioModel } from '@/lib/engine/scenario-band';
import { buildLicenceBreakEven } from '@/lib/engine/licence-break-even';
import { normalise } from '@/lib/engine/normalise';
import type { Recommendation, RuleOutcome } from '@/lib/engine/types';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { answersWith, audit, card, flatAnswers, near } from './fixtures';

function recommend(
  workloads: WorkloadId[],
  usageOverrides: Partial<Record<WorkloadId, Record<string, unknown>>> = {},
  patch: Parameters<typeof answersWith>[2] = {},
  flat = false,
) {
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
  };
  const options = buildFundingOptions(input, trail);
  return {
    rec: buildRecommendation(options, scenario, normalised, licenceBreakEven, card, trail),
    options,
    scenario,
    licenceBreakEven,
    trail,
  };
}

const rule = (rec: Recommendation, id: RuleOutcome['id']): RuleOutcome => {
  const found = rec.rules.find((r) => r.id === id);
  if (!found) throw new Error(`missing rule ${id}`);
  return found;
};

const BASE: WorkloadId[] = ['m365-copilot-chat', 'copilot-studio-agents'];

const COMMITTABLE = {
  growth: { canCommitAnnually: true, confidence: 'high', budgetTolerance: 'never' },
} as Parameters<typeof answersWith>[2];

describe('the seven rules (SPEC §6.6)', () => {
  it('always evaluates all seven in a stable order', () => {
    const { rec } = recommend(BASE);
    expect(rec.rules.map((r) => r.id)).toEqual([
      'volatility',
      'waste',
      'commit',
      'macc',
      'licence',
      'governance',
      'safety-net',
    ]);
  });

  it('gives every rule a name, a reason, an effect and evidence', () => {
    for (const r of recommend(BASE).rec.rules) {
      expect(r.name.length, r.id).toBeGreaterThan(0);
      expect(r.reason.length, r.id).toBeGreaterThan(0);
      expect(r.effect.length, r.id).toBeGreaterThan(0);
      expect(Object.keys(r.evidence).length, r.id).toBeGreaterThan(0);
    }
  });
});

describe('rule 1 — volatility', () => {
  it('fires when the coefficient of variation exceeds the threshold', () => {
    const { rec, scenario } = recommend(BASE);
    const r = rule(rec, 'volatility');
    expect(scenario.coefficientOfVariation).toBeGreaterThan(
      card.modelAssumptions.volatilityThreshold,
    );
    expect(r.fired).toBe(true);
    expect(r.reason).toContain('above the');
    expect(r.effect).toContain(`P${card.modelAssumptions.packSizingPercentileWhenVolatile}`);
  });

  it('does not fire for a perfectly flat estate', () => {
    const { rec } = recommend(BASE, {}, {}, true);
    const r = rule(rec, 'volatility');
    expect(r.fired).toBe(false);
    expect(r.reason).toContain('stable');
    expect(r.effect).toContain(`P${card.modelAssumptions.packSizingPercentile}`);
  });

  it('publishes the mean and standard deviation as evidence', () => {
    const { rec, scenario } = recommend(BASE);
    expect(rule(rec, 'volatility').evidence).toMatchObject({
      coefficientOfVariation: scenario.coefficientOfVariation,
      threshold: card.modelAssumptions.volatilityThreshold,
      meanMonthlyCredits: scenario.meanMonthlyCredits,
    });
  });
});

describe('rule 2 — waste', () => {
  it('disqualifies a prepaid option that wastes more than the limit', () => {
    const { rec } = recommend(BASE, {}, COMMITTABLE);
    const r = rule(rec, 'waste');
    if (r.fired) {
      expect(r.effect).toContain('Disqualified');
      const blocked = rec.ranked.filter((o) => o.tradeOff.includes('go unused'));
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked[0]?.blocked).toBe(true);
      expect(Number.isFinite(blocked[0]!.score)).toBe(true);
    }
  });

  it('does not fire when prepaid capacity is well matched to demand', () => {
    const { rec } = recommend(BASE, {}, COMMITTABLE, true);
    const r = rule(rec, 'waste');
    expect(r.reason).toContain(`${card.modelAssumptions.maxAcceptableWastePct}%`);
    if (!r.fired) expect(r.effect).toBe('No option disqualified on waste.');
  });

  it('publishes a waste percentage per prepaid option as evidence', () => {
    const { rec } = recommend(BASE, {}, COMMITTABLE);
    const keys = Object.keys(rule(rec, 'waste').evidence);
    expect(keys.some((k) => k.endsWith('WastePct'))).toBe(true);
  });
});

describe('rule 3 — commit', () => {
  it('fires and disqualifies both pre-purchase options when the org cannot commit', () => {
    const { rec } = recommend(BASE, {}, { growth: { canCommitAnnually: false } });
    expect(rule(rec, 'commit').fired).toBe(true);
    for (const id of ['p3-plus-payg', 'p3-packs-payg'] as const) {
      expect(rec.ranked.find((o) => o.optionId === id)?.blocked).toBe(true);
    }
  });

  it('fires when forecast confidence is low', () => {
    const { rec } = recommend(BASE, {}, { growth: { canCommitAnnually: true, confidence: 'low' } });
    const r = rule(rec, 'commit');
    expect(r.fired).toBe(true);
    expect(r.reason).toContain('confidence is low');
    expect(r.effect).toContain('excluded from the recommendation');
  });

  it('fires when the estate never reaches the smallest tier', () => {
    const { rec } = recommend([], {}, COMMITTABLE);
    expect(rule(rec, 'commit').fired).toBe(true);
    expect(rule(rec, 'commit').reason).toContain('smallest published pre-purchase tier');
  });

  it('does not fire for a confident, committable, large estate', () => {
    const { rec } = recommend(BASE, {}, COMMITTABLE);
    const r = rule(rec, 'commit');
    expect(r.fired).toBe(false);
    expect(r.reason).toContain('clears a published pre-purchase tier');
    expect(r.effect).toContain('% discount');
  });
});

describe('rule 4 — MACC', () => {
  it('fires and discounts every MACC-eligible option when commitment is unspent', () => {
    const { rec } = recommend(BASE, {}, { growth: { hasUnspentAzureCommitment: true } });
    const r = rule(rec, 'macc');
    expect(r.fired).toBe(true);
    expect(r.effect).toContain('confirm with your Microsoft account team');
    expect(r.evidence.hasUnspentAzureCommitment).toBe(true);
  });

  it('does not fire when no commitment was declared', () => {
    const { rec } = recommend(BASE, {}, { growth: { hasUnspentAzureCommitment: false } });
    const r = rule(rec, 'macc');
    expect(r.fired).toBe(false);
    expect(r.effect).toBe('No commitment burn-down weighting applied.');
  });

  it('applies a 5% weighting so the eligible option scores below its raw total', () => {
    const withMacc = recommend(BASE, {}, { growth: { hasUnspentAzureCommitment: true } }).rec;
    const entry = withMacc.ranked.find((o) => o.optionId === 'payg');
    expect(near(entry!.score)).toBe(near(entry!.twelveMonthTotalUsd * 0.95));
  });
});

describe('rule 5 — licence', () => {
  it('fires when average unlicensed consumption clears the seat break-even', () => {
    const { rec, licenceBreakEven } = recommend(
      ['m365-copilot-chat'],
      { 'm365-copilot-chat': { users: 400, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 300 } },
      { profile: { knowledgeWorkers: 400 } },
    );
    expect(licenceBreakEven.creditsPerUnlicensedInternalUserPerMonth).toBeGreaterThan(3000);
    const r = rule(rec, 'licence');
    expect(r.fired).toBe(true);
    expect(r.reason).toContain('above the 3,000-credit seat break-even');
    expect(r.effect).toContain('Shift licensing first');
  });

  it('does not fire for a lightly-used estate', () => {
    const { rec } = recommend(
      ['m365-copilot-chat'],
      {
        'm365-copilot-chat': {
          users: 5000,
          m365CopilotLicensedPct: 0,
          messagesPerUserPerDay: 1,
          generativeSharePct: 0,
          graphGroundingPct: 0,
        },
      },
      { profile: { knowledgeWorkers: 5000 } },
    );
    const r = rule(rec, 'licence');
    expect(r.fired).toBe(false);
    expect(r.reason).toContain('below the 3,000-credit seat break-even');
    expect(r.effect).toContain('productivity value');
  });

  it('applies a 15% weighting to licence shift when it fires', () => {
    const { rec } = recommend(
      ['m365-copilot-chat'],
      { 'm365-copilot-chat': { users: 400, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 300 } },
      { profile: { knowledgeWorkers: 400 } },
    );
    const entry = rec.ranked.find((o) => o.optionId === 'licence-shift');
    if (entry && !entry.blocked) {
      expect(near(entry.score)).toBe(near(entry.twelveMonthTotalUsd * 0.85));
    }
  });
});

describe('rule 6 — governance', () => {
  it('fires and adds attribution actions when per-BU cost attribution is needed', () => {
    const { rec } = recommend(BASE, {}, { growth: { costAttributionPerBu: true } });
    expect(rule(rec, 'governance').fired).toBe(true);
    expect(rec.governanceActions.join(' ')).toContain('separate billing policy per business unit');
    expect(rec.governanceActions.join(' ')).toContain('per environment');
  });

  it('does not fire when attribution is not required', () => {
    const { rec } = recommend(BASE, {}, { growth: { costAttributionPerBu: false } });
    expect(rule(rec, 'governance').fired).toBe(false);
  });

  it('adds a consumption-alerts action when the leading candidate is prepaid', () => {
    const { rec } = recommend(BASE, {}, COMMITTABLE);
    const leading = rec.ranked.find((o) => !o.blocked);
    if (
      leading &&
      ['packs-only', 'packs-plus-payg', 'p3-plus-payg', 'p3-packs-payg'].includes(leading.optionId)
    ) {
      expect(rec.governanceActions.join(' ')).toContain('50%, 80% and 100%');
    }
  });

  it('adds an ownership action when forecast confidence is low', () => {
    const { rec } = recommend(BASE, {}, { growth: { confidence: 'low' } });
    expect(rec.governanceActions.join(' ')).toContain('Nominate an owner');
  });

  it('reports how many actions were added', () => {
    const { rec } = recommend(BASE, {}, { growth: { costAttributionPerBu: true } });
    expect(rule(rec, 'governance').effect).toContain(
      `${rec.governanceActions.length} governance action`,
    );
  });
});

describe('rule 7 — safety net', () => {
  it('fires and disqualifies the hard-stop option when an overage is preferred', () => {
    const { rec } = recommend(BASE, {}, { growth: { budgetTolerance: 'tolerable' } });
    const r = rule(rec, 'safety-net');
    expect(r.fired).toBe(true);
    expect(rec.safetyNet).toContain('degrade gracefully');
    expect(rec.ranked.find((o) => o.optionId === 'packs-only')?.blocked).toBe(true);
  });

  it('does not fire and leaves hard-stop options on the table when a stop is acceptable', () => {
    const { rec } = recommend(BASE, {}, { growth: { budgetTolerance: 'never' } });
    const r = rule(rec, 'safety-net');
    expect(r.fired).toBe(false);
    expect(rec.safetyNet).toBeNull();
    expect(r.effect).toContain('remain on the table');
  });
});

describe('scoring and ranking', () => {
  it('scores an unblocked option as its total times the rule multipliers', () => {
    const { rec } = recommend(BASE, {}, { growth: { hasUnspentAzureCommitment: false } });
    const payg = rec.ranked.find((o) => o.optionId === 'payg');
    expect(near(payg!.score)).toBe(near(payg!.twelveMonthTotalUsd));
  });

  it('ranks every eligible option ahead of every blocked one, each group ascending by score', () => {
    const ranked = recommend(BASE).rec.ranked;
    const firstBlocked = ranked.findIndex((o) => o.blocked);
    if (firstBlocked >= 0) {
      expect(ranked.slice(firstBlocked).every((o) => o.blocked)).toBe(true);
    }
    for (const group of [ranked.filter((o) => !o.blocked), ranked.filter((o) => o.blocked)]) {
      for (let i = 1; i < group.length; i += 1) {
        expect(group[i]!.score).toBeGreaterThanOrEqual(group[i - 1]!.score);
      }
    }
  });

  it('keeps a real, finite score on a blocked option rather than a sentinel', () => {
    const { rec } = recommend(BASE, {}, { growth: { canCommitAnnually: false } });
    const blocked = rec.ranked.filter((o) => o.blocked);
    expect(blocked.length).toBeGreaterThan(0);
    for (const o of blocked) {
      expect(Number.isFinite(o.score)).toBe(true);
      // Infinity does not survive JSON.stringify — it becomes null.
      expect(JSON.parse(JSON.stringify({ s: o.score })).s).toBe(o.score);
    }
  });

  it('ranks all eight options', () => {
    expect(recommend(BASE).rec.ranked).toHaveLength(8);
  });

  it('picks the lowest-scoring unblocked option as primary', () => {
    const { rec } = recommend(BASE);
    expect(rec.primary.optionId).toBe(rec.ranked[0]?.optionId);
    const unblocked = rec.ranked.filter((o) => !o.blocked);
    expect(rec.primary.score).toBe(Math.min(...unblocked.map((o) => o.score)));
    expect(rec.primary.blocked).toBe(false);
    expect(Number.isFinite(rec.primary.score)).toBe(true);
  });

  it('offers exactly two alternatives', () => {
    expect(recommend(BASE).rec.alternatives).toHaveLength(2);
    expect(recommend([]).rec.alternatives).toHaveLength(2);
  });

  it('never repeats the primary among the alternatives', () => {
    const { rec } = recommend(BASE);
    for (const alt of rec.alternatives) expect(alt.optionId).not.toBe(rec.primary.optionId);
  });

  it('expresses every delta relative to the primary', () => {
    const { rec } = recommend(BASE);
    expect(rec.primary.deltaVsPrimaryUsd).toBe(0);
    for (const entry of rec.ranked) {
      expect(near(entry.deltaVsPrimaryUsd)).toBe(
        near(entry.twelveMonthTotalUsd - rec.primary.twelveMonthTotalUsd),
      );
    }
  });

  it('gives a disqualified option the reason it was blocked as its trade-off', () => {
    const { rec } = recommend(BASE, {}, { growth: { canCommitAnnually: false } });
    const blocked = rec.ranked.find((o) => o.optionId === 'p3-plus-payg');
    expect(blocked?.blocked).toBe(true);
    expect(blocked?.tradeOff).toContain('annual commitment');
  });

  it('never recommends doing nothing while there is real demand', () => {
    const { rec } = recommend(BASE);
    const doNothing = rec.ranked.find((o) => o.optionId === 'do-nothing');
    expect(doNothing?.blocked).toBe(true);
    expect(doNothing?.tradeOff).toContain('baseline for comparison');
    expect(rec.primary.optionId).not.toBe('do-nothing');
  });

  it('leaves doing nothing eligible when there is genuinely no demand', () => {
    const { rec } = recommend([]);
    const doNothing = rec.ranked.find((o) => o.optionId === 'do-nothing');
    expect(doNothing?.score).toBe(0);
    expect(rec.primary.score).toBe(0);
  });
});

describe('headline and saving', () => {
  it('quantifies the saving against naive pay-as-you-go', () => {
    const { rec, options } = recommend(BASE);
    const payg = options.find((o) => o.id === 'payg')!;
    expect(near(rec.annualSavingVsNaivePaygUsd)).toBe(
      near(payg.twelveMonthTotalUsd - rec.primary.twelveMonthTotalUsd),
    );
  });

  it('names the primary option and its twelve-month total', () => {
    const { rec } = recommend(BASE);
    expect(rec.headline).toContain('over twelve months');
    expect(rec.headline.startsWith('Fund this with ')).toBe(true);
  });

  it('preserves acronym casing in the headline', () => {
    const { rec } = recommend(BASE);
    expect(rec.headline).not.toMatch(/azure ai foundry|p3 pre-purchase/);
  });

  it('mentions the overage policy when the safety net applies', () => {
    const { rec } = recommend(BASE, {}, { growth: { budgetTolerance: 'tolerable' } });
    expect(rec.headline).toContain('pay-as-you-go overage policy behind it');
  });

  it('explains why a more expensive option still wins', () => {
    const { rec } = recommend(BASE);
    if (rec.annualSavingVsNaivePaygUsd < 0) {
      expect(rec.headline).toContain('more than the metered baseline but');
    } else {
      expect(rec.headline).toContain('less than paying full retail');
    }
  });

  it('maps confidence to a display chip', () => {
    expect(recommend(BASE, {}, { growth: { confidence: 'high' } }).rec.confidenceChip).toBe('High');
    expect(recommend(BASE, {}, { growth: { confidence: 'medium' } }).rec.confidenceChip).toBe('Medium');
    expect(recommend(BASE, {}, { growth: { confidence: 'low' } }).rec.confidenceChip).toBe('Low');
  });

  it('records the scoring formula in the audit trail', () => {
    const { trail, rec } = recommend(BASE);
    const entry = trail.entries.find((e) => e.step === 'recommendation:primary');
    expect(entry?.formula).toContain('Π(ruleMultipliers)');
    expect(entry?.output).toBe(rec.annualSavingVsNaivePaygUsd);
    expect(entry?.inputs.primary).toBe(rec.primary.optionId);
  });
});

describe('effectiveRateFor', () => {
  it('is the all-in twelve-month cost divided by credits served', () => {
    const { options } = recommend(BASE);
    const payg = options.find((o) => o.id === 'payg')!;
    expect(near(effectiveRateFor(payg))).toBe(
      near(payg.twelveMonthTotalUsd / payg.creditsServed),
    );
  });

  it('returns zero rather than dividing by zero when nothing is served', () => {
    const { options } = recommend(BASE);
    expect(effectiveRateFor(options.find((o) => o.id === 'do-nothing')!)).toBe(0);
  });
});
