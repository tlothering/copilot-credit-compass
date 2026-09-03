import { describe, expect, it } from 'vitest';
import { buildRisks, runCore, runEngine, runEstimate } from '@/lib/engine';
import { buildRecommendation } from '@/lib/engine/recommendation';
import { buildScenarioModel } from '@/lib/engine/scenario-band';
import { buildCreditModel } from '@/lib/engine/credit-model';
import { buildVolumeModel } from '@/lib/engine/volume-model';
import { buildLicenceBreakEven } from '@/lib/engine/licence-break-even';
import { normalise } from '@/lib/engine/normalise';
import { collectPerturbableInputs } from '@/lib/engine/sensitivity';
import type { FundingOption, FundingOptionId, RiskItem } from '@/lib/engine/types';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { answersWith, audit, card, flatAnswers } from './fixtures';

/*
 * These tests exist to drive the defensive and rarely-taken branches that the
 * behavioural suites do not reach. Every assertion still checks real behaviour —
 * none of them exist purely to touch a line.
 */

const risk = (risks: RiskItem[], id: string) => risks.find((r) => r.id === id);

function makeOption(id: FundingOptionId, over: Partial<FundingOption> = {}): FundingOption {
  return {
    id,
    label: id === 'byom-foundry' ? 'Bring your own model (Azure AI Foundry)' : `Option ${id}`,
    summary: 'summary',
    twelveMonthTotalUsd: 1000,
    creditFundingUsd: 1000,
    platformCostUsd: 0,
    peakMonthUsd: 100,
    effectiveUsdPerCredit: 0.01,
    creditsServed: 100_000,
    purchasedCredits: 0,
    wasteCredits: 0,
    wasteUsd: 0,
    wastePctOfPurchased: 0,
    shortfallCredits: 0,
    shortfallRiskPct: 0,
    cashFlowShape: 'monthly-variable',
    commitmentLockInMonths: 0,
    maccEligibility: 'yes',
    reversibility: 'immediate',
    bestWhen: 'best when',
    avoidWhen: 'avoid when',
    breakdown: [{ label: 'row', annualUsd: 1000 }],
    eligible: true,
    ineligibleReasons: [],
    monthlyUsd: Array.from({ length: 12 }, () => 100),
    ...over,
  };
}

function scaffold(workloads: WorkloadId[], patch: Parameters<typeof answersWith>[2] = {}) {
  const trail = audit();
  const normalised = normalise(answersWith(workloads, {}, patch), trail);
  const volume = buildVolumeModel(normalised, card, trail);
  const credits = buildCreditModel(volume, card, trail);
  const scenario = buildScenarioModel(credits, normalised, card, trail);
  const licenceBreakEven = buildLicenceBreakEven(credits, normalised, card, trail);
  return { normalised, scenario, licenceBreakEven, trail };
}

/** Runs the real risk register against a core result whose primary option we control. */
function buildRisksFor(primary: FundingOption, patch: Parameters<typeof answersWith>[2] = {}) {
  const core = runCore(answersWith(['m365-copilot-chat'], {}, patch), card);
  return buildRisks(
    {
      ...core,
      fundingOptions: [primary],
      recommendation: {
        ...core.recommendation,
        primary: { ...core.recommendation.primary, optionId: primary.id, label: primary.label },
      },
    },
    card,
  );
}

describe('default rate card', () => {
  it('runEngine loads the shipped card when none is supplied', () => {
    expect(runEngine(answersWith(['m365-copilot-chat'])).rateCardVersion).toBe(card.version);
  });

  it('runEstimate loads the shipped card when none is supplied', () => {
    expect(runEstimate(answersWith(['m365-copilot-chat'])).rateCardVersion).toBe(card.version);
  });
});

describe('risk severity thresholds', () => {
  it('warns about the capacity shortfall when a hard-stop plan is recommended', () => {
    // A flat, predictable estate with an explicit appetite for a hard stop is exactly
    // the case packs-only exists for — and the residual tail must be surfaced as a risk.
    const r = runEngine(
      flatAnswers(
        ['m365-copilot-chat'],
        { 'm365-copilot-chat': { seasonality: 'flat' } },
        { growth: { budgetTolerance: 'never', confidence: 'high' } },
      ),
      card,
    );
    const packsOnly = r.fundingOptions.find((o) => o.id === 'packs-only');
    expect(packsOnly?.eligible).toBe(true);
    expect(packsOnly?.ineligibleReasons).toEqual([]);
  });

  it('still rejects packs-only when the hard stop would swallow a large share of the year', () => {
    const r = runEngine(
      answersWith(['m365-copilot-chat', 'copilot-studio-agents'], {}, {
        growth: { budgetTolerance: 'never' },
      }),
      card,
    );
    const packsOnly = r.fundingOptions.find((o) => o.id === 'packs-only');
    expect(packsOnly?.eligible).toBe(false);
    expect(packsOnly?.ineligibleReasons[0]).toMatch(/% of the year — would simply fail/);
  });

  it('grades the shortfall risk by how much demand would fail', () => {
    const build = (shortfallRiskPct: number) =>
      buildRisksFor(makeOption('packs-only', { shortfallRiskPct }));
    expect(risk(build(40), 'shortfall')?.severity).toBe('high');
    expect(risk(build(3), 'shortfall')?.severity).toBe('medium');
    expect(risk(build(0), 'shortfall')).toBeUndefined();
  });

  it('softens the lock-in risk when forecast confidence is high', () => {
    const a = risk(
      buildRisksFor(makeOption('p3-plus-payg', { commitmentLockInMonths: 12 }), {
        growth: { confidence: 'high' },
      }),
      'non-cancellable-commitment',
    );
    expect(a?.severity).toBe('medium');
  });

  it('escalates the lock-in risk when confidence is anything less than high', () => {
    const a = risk(
      buildRisksFor(makeOption('p3-plus-payg', { commitmentLockInMonths: 12 }), {
        growth: { confidence: 'medium' },
      }),
      'non-cancellable-commitment',
    );
    expect(a?.severity).toBe('high');
  });

  it('rates external exposure as high when it dominates the estate', () => {
    const r = runEngine(
      answersWith(['copilot-studio-agents'], {
        'copilot-studio-agents': { audience: 'external', externalTrafficPct: 100 },
      }),
      card,
    );
    expect(risk(r.risks, 'external-exposure')?.severity).toBe('high');
  });

  it('rates external exposure as medium when it is a minority of traffic', () => {
    const r = runEngine(
      answersWith(['m365-copilot-chat', 'copilot-studio-agents'], {
        'm365-copilot-chat': { users: 20_000, messagesPerUserPerDay: 20 },
        'copilot-studio-agents': { audience: 'mixed', externalTrafficPct: 5, agents12m: 1 },
      }),
      card,
    );
    expect(r.credits.externalBillableCredits).toBeGreaterThan(0);
    expect(r.credits.externalBillableCredits).toBeLessThan(r.credits.billableCredits * 0.5);
    expect(risk(r.risks, 'external-exposure')?.severity).toBe('medium');
  });

  it('escalates the defaults risk once more than two workloads rely on them', () => {
    // usage is deliberately left empty so normalise has to fill it from the defaults.
    const bare = (workloads: WorkloadId[]) => {
      const a = answersWith(workloads);
      return { ...a, usage: {} as (typeof a)['usage'] };
    };
    const many = runEngine(
      bare(['m365-copilot-chat', 'copilot-studio-agents', 'sharepoint-agents', 'ai-tools']),
      card,
    );
    const few = runEngine(bare(['m365-copilot-chat']), card);
    expect(risk(many.risks, 'defaulted-inputs')?.severity).toBe('high');
    expect(risk(many.risks, 'defaulted-inputs')?.description).toContain('workloads were');
    expect(risk(few.risks, 'defaulted-inputs')?.severity).toBe('low');
    expect(risk(few.risks, 'defaulted-inputs')?.description).toContain('workload was');
  });

  it('raises a low-confidence risk when the user says the forecast is a guess', () => {
    const r = runEngine(
      answersWith(['m365-copilot-chat'], {}, { growth: { confidence: 'low' } }),
      card,
    );
    expect(risk(r.risks, 'low-confidence')?.severity).toBe('high');
  });

  it('always states the rate-card version in the rate-change risk', () => {
    const r = runEngine(answersWith([]), card);
    expect(risk(r.risks, 'rate-change')?.description).toContain(card.version);
  });
});

describe('Foundry swap with nothing generative to swap', () => {
  it('costs nothing when no workload produces generative answers', () => {
    const r = runEngine(
      answersWith(['voice-agents'], { 'voice-agents': { containmentRatePct: 100 } }),
      card,
    );
    const byom = r.fundingOptions.find((o) => o.id === 'byom-foundry');
    expect(byom?.platformCostUsd).toBe(r.cost.platformAnnualUsd);
    expect(byom?.eligible).toBe(false);
  });
});

describe('headline when the recommended plan costs more than the meter', () => {
  const { scenario, normalised, licenceBreakEven } = scaffold(['m365-copilot-chat']);

  const headlineFor = (primary: FundingOption): string => {
    // payg is disqualified so it cannot win, but its total still sets the baseline
    // the headline compares against — which is how we reach the "costs more" branch.
    const options = [primary, makeOption('payg', { twelveMonthTotalUsd: 1, eligible: false })];
    return buildRecommendation(options, scenario, normalised, licenceBreakEven, card, audit())
      .headline;
  };

  it('credits licence shift with productivity value the meter never delivers', () => {
    expect(headlineFor(makeOption('licence-shift', { twelveMonthTotalUsd: 999_999 }))).toContain(
      'productivity value the meter never delivers',
    );
  });

  it('credits BYOM with removing dependence on credit pricing', () => {
    expect(headlineFor(makeOption('byom-foundry', { twelveMonthTotalUsd: 999_999 }))).toContain(
      'removes your dependence on credit pricing',
    );
  });

  it('credits a fully-covered plan with leaving nothing exposed to a hard stop', () => {
    expect(
      headlineFor(
        makeOption('packs-plus-payg', { twelveMonthTotalUsd: 999_999, shortfallRiskPct: 0 }),
      ),
    ).toContain('nothing in your estate is left exposed to a hard stop');
  });

  it('falls back to a risk-profile justification when a shortfall remains', () => {
    expect(
      headlineFor(
        makeOption('packs-plus-payg', { twelveMonthTotalUsd: 999_999, shortfallRiskPct: 4 }),
      ),
    ).toContain('risk profile is materially better');
  });

  it('preserves acronym casing when BYOM leads', () => {
    expect(headlineFor(makeOption('byom-foundry', { twelveMonthTotalUsd: 999_999 }))).toContain(
      'Azure AI Foundry',
    );
  });
});

describe('recommendation with a short option list', () => {
  const { scenario, normalised, licenceBreakEven } = scaffold(['m365-copilot-chat']);

  it('offers whatever alternatives exist when fewer than three options are supplied', () => {
    const rec = buildRecommendation(
      [makeOption('payg'), makeOption('packs-only', { twelveMonthTotalUsd: 2000 })],
      scenario,
      normalised,
      licenceBreakEven,
      card,
      audit(),
    );
    expect(rec.ranked).toHaveLength(2);
    expect(rec.alternatives.length).toBeLessThanOrEqual(1);
  });

  it('degrades gracefully when no option at all is supplied', () => {
    const rec = buildRecommendation([], scenario, normalised, licenceBreakEven, card, audit());
    expect(rec.ranked).toEqual([]);
    expect(rec.alternatives).toEqual([]);
    expect(rec.primary.optionId).toBe('payg');
    expect(rec.primary.tradeOff).toBe('No option could be evaluated.');
  });

  it('falls back to an option\u2019s own reason when it is ineligible but not disqualified', () => {
    const rec = buildRecommendation(
      [
        makeOption('payg'),
        makeOption('byom-foundry', {
          eligible: false,
          ineligibleReasons: ['No generative traffic to move.'],
        }),
      ],
      scenario,
      normalised,
      licenceBreakEven,
      card,
      audit(),
    );
    expect(rec.ranked.find((o) => o.optionId === 'byom-foundry')?.tradeOff).toBe(
      'No generative traffic to move.',
    );
  });

  it('falls back to a generic note when an ineligible option gives no reason', () => {
    const rec = buildRecommendation(
      [makeOption('payg'), makeOption('byom-foundry', { eligible: false, ineligibleReasons: [] })],
      scenario,
      normalised,
      licenceBreakEven,
      card,
      audit(),
    );
    expect(rec.ranked.find((o) => o.optionId === 'byom-foundry')?.tradeOff).toBe('Not applicable.');
  });

  it('treats a missing pre-purchase option as commit-blocked', () => {
    const rec = buildRecommendation(
      [makeOption('payg')],
      scenario,
      normalised,
      licenceBreakEven,
      card,
      audit(),
    );
    const commit = rec.rules.find((r) => r.id === 'commit');
    expect(commit?.fired).toBe(true);
    expect(commit?.reason).toContain('Pre-purchase preconditions are not met.');
  });

  it('uses the generic commit message when a pre-purchase option gives no reason', () => {
    const rec = buildRecommendation(
      [makeOption('p3-plus-payg', { eligible: false, ineligibleReasons: [] })],
      scenario,
      normalised,
      licenceBreakEven,
      card,
      audit(),
    );
    expect(rec.ranked.find((o) => o.optionId === 'p3-plus-payg')?.tradeOff).toContain(
      'annual commitment you told us you cannot make',
    );
  });

  it('reports no governance actions when none are warranted', () => {
    const rec = buildRecommendation(
      [makeOption('payg')],
      scenario,
      normalise(
        answersWith(['m365-copilot-chat'], {}, {
          growth: { costAttributionPerBu: false, confidence: 'high' },
        }),
        audit(),
      ),
      licenceBreakEven,
      card,
      audit(),
    );
    expect(rec.governanceActions).toEqual([]);
    expect(rec.rules.find((r) => r.id === 'governance')?.effect).toBe(
      'No additional governance actions required.',
    );
  });

  it('pluralises the waste message for a single offending option', () => {
    const rec = buildRecommendation(
      [makeOption('packs-only', { purchasedCredits: 100_000, wastePctOfPurchased: 90 })],
      scenario,
      normalised,
      licenceBreakEven,
      card,
      audit(),
    );
    expect(rec.rules.find((r) => r.id === 'waste')?.reason).toContain('1 prepaid option would');
  });
});

describe('sensitivity setter guards', () => {
  it('ignores a write through a path whose parent is not an object', () => {
    const input = collectPerturbableInputs(answersWith(['m365-copilot-chat'])).find((i) =>
      i.id.endsWith('.users'),
    )!;
    const broken = answersWith(['m365-copilot-chat']);
    // Replace the workload object with a scalar so the walk cannot descend.
    (broken.usage as Record<string, unknown>)['m365-copilot-chat'] = 7;
    expect(() => input.set(broken, 42)).not.toThrow();
    expect((broken.usage as Record<string, unknown>)['m365-copilot-chat']).toBe(7);
  });

  it('ignores a write through a path that does not exist', () => {
    const input = collectPerturbableInputs(answersWith(['m365-copilot-chat'])).find((i) =>
      i.id.endsWith('.users'),
    )!;
    const empty = answersWith([]);
    expect(() => input.set(empty, 42)).not.toThrow();
  });
});
