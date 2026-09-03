import { describe, expect, it } from 'vitest';
import { buildScenarioModel } from '@/lib/engine/scenario-band';
import { buildCreditModel } from '@/lib/engine/credit-model';
import { buildVolumeModel } from '@/lib/engine/volume-model';
import { normalise } from '@/lib/engine/normalise';
import type { ConfidenceLevel, WorkloadId } from '@/lib/schemas/taxonomy';
import { answersWith, audit, card, flatAnswers, near } from './fixtures';

function scenarioFor(answers: ReturnType<typeof answersWith>) {
  const trail = audit();
  const normalised = normalise(answers, trail);
  const volume = buildVolumeModel(normalised, card, trail);
  const credits = buildCreditModel(volume, card, trail);
  return {
    model: buildScenarioModel(credits, normalised, card, trail),
    steadyState: credits.billableCredits,
    trail,
  };
}

const FLAT_WORKLOAD: WorkloadId[] = ['m365-copilot-chat'];

describe('confidence multipliers (SPEC §6.4)', () => {
  it.each(['low', 'medium', 'high'] as const)(
    'band multipliers for %s confidence come from the rate card',
    (confidence: ConfidenceLevel) => {
      const expected = card.modelAssumptions.confidenceMultipliers[confidence];
      const { model } = scenarioFor(flatAnswers(FLAT_WORKLOAD, {}, { growth: { confidence } }));
      expect(model.bands.conservative.multiplier).toBe(expected.conservative);
      expect(model.bands.expected.multiplier).toBe(expected.expected);
      expect(model.bands.aggressive.multiplier).toBe(expected.aggressive);
    },
  );

  it('widens the band as confidence falls', () => {
    const spread = (confidence: ConfidenceLevel) => {
      const { model } = scenarioFor(flatAnswers(FLAT_WORKLOAD, {}, { growth: { confidence } }));
      return model.bands.aggressive.monthlyCredits - model.bands.conservative.monthlyCredits;
    };
    expect(spread('low')).toBeGreaterThan(spread('medium'));
    expect(spread('medium')).toBeGreaterThan(spread('high'));
  });

  it('always keeps the expected band at the steady-state run rate', () => {
    for (const confidence of ['low', 'medium', 'high'] as const) {
      const { model, steadyState } = scenarioFor(
        flatAnswers(FLAT_WORKLOAD, {}, { growth: { confidence } }),
      );
      expect(model.bands.expected.multiplier).toBe(1);
      expect(near(model.bands.expected.monthlyCredits)).toBe(near(steadyState));
    }
  });
});

describe('monthly projection', () => {
  it('is steady state × ramp × seasonality × band multiplier', () => {
    const answers = answersWith(
      ['m365-copilot-chat'],
      {},
      { growth: { rampMonth1Pct: 50, rampMonth3Pct: 50, rampMonth6Pct: 50, rampMonth12Pct: 50 } },
    );
    const { model, steadyState } = scenarioFor(answers);
    for (const point of model.months) {
      expect(near(point.expectedCredits)).toBe(near(steadyState * 0.5));
    }
  });

  it('produces exactly 12 labelled months in order', () => {
    const { model } = scenarioFor(flatAnswers(FLAT_WORKLOAD));
    expect(model.months).toHaveLength(12);
    expect(model.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(model.months[0]?.label).toBe('Month 1');
    expect(model.months[11]?.label).toBe('Month 12');
  });

  it('annual credits equal the sum of the twelve monthly figures', () => {
    const { model } = scenarioFor(answersWith(FLAT_WORKLOAD));
    expect(near(model.bands.expected.annualCredits)).toBe(
      near(model.expectedMonthlyCredits.reduce((a, b) => a + b, 0)),
    );
    expect(near(model.bands.conservative.annualCredits)).toBe(
      near(model.conservativeMonthlyCredits.reduce((a, b) => a + b, 0)),
    );
    expect(near(model.bands.aggressive.annualCredits)).toBe(
      near(model.aggressiveMonthlyCredits.reduce((a, b) => a + b, 0)),
    );
  });

  it('is 12 × the steady state under a flat ramp and flat seasonality', () => {
    const { model, steadyState } = scenarioFor(flatAnswers(FLAT_WORKLOAD));
    expect(near(model.bands.expected.annualCredits)).toBe(near(steadyState * 12));
  });

  it('costs credits at the pay-as-you-go rate', () => {
    const { model } = scenarioFor(flatAnswers(FLAT_WORKLOAD));
    expect(near(model.bands.expected.monthlyCreditCostUsd)).toBe(
      near(model.bands.expected.monthlyCredits * 0.01),
    );
    expect(near(model.bands.aggressive.annualCreditCostUsd)).toBe(
      near(model.bands.aggressive.annualCredits * 0.01),
    );
  });

  it('never projects a negative month', () => {
    const { model } = scenarioFor(answersWith(FLAT_WORKLOAD, {}, { growth: { rampMonth1Pct: 0 } }));
    for (const c of model.expectedMonthlyCredits) expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe('seasonality and the peak month', () => {
  it('identifies the seasonal spike as the peak month', () => {
    const answers = flatAnswers(['copilot-studio-agents'], {
      'copilot-studio-agents': { seasonality: 'seasonal-spike', peakMonthMultiplier: 2, peakMonth: 7 },
    });
    const { model } = scenarioFor(answers);
    expect(model.peakMonthIndex).toBe(7);
    expect(near(model.peakMonthCredits)).toBe(near(model.bands.expected.monthlyCredits * 2));
  });

  it('makes month 12 the peak under a rising ramp with flat seasonality', () => {
    const { model } = scenarioFor(answersWith(FLAT_WORKLOAD));
    expect(model.peakMonthIndex).toBe(12);
  });

  it('reports month 1 as the peak when every month is identical', () => {
    const { model } = scenarioFor(flatAnswers(FLAT_WORKLOAD));
    expect(model.peakMonthIndex).toBe(1);
  });
});

describe('volatility', () => {
  it('is zero for a perfectly flat twelve months', () => {
    const { model } = scenarioFor(flatAnswers(FLAT_WORKLOAD));
    expect(near(model.coefficientOfVariation)).toBe(0);
    expect(near(model.stdDevMonthlyCredits)).toBe(0);
  });

  it('rises with a steep adoption ramp', () => {
    const { model } = scenarioFor(
      answersWith(
        FLAT_WORKLOAD,
        {},
        { growth: { rampMonth1Pct: 5, rampMonth3Pct: 15, rampMonth6Pct: 40, rampMonth12Pct: 100 } },
      ),
    );
    expect(model.coefficientOfVariation).toBeGreaterThan(card.modelAssumptions.volatilityThreshold);
  });

  it('rises with a large seasonal spike', () => {
    const { model } = scenarioFor(
      flatAnswers(['copilot-studio-agents'], {
        'copilot-studio-agents': { seasonality: 'seasonal-spike', peakMonthMultiplier: 5, peakMonth: 6 },
      }),
    );
    expect(model.coefficientOfVariation).toBeGreaterThan(0.3);
  });

  it('reports mean and standard deviation consistently with the monthly curve', () => {
    const { model } = scenarioFor(answersWith(FLAT_WORKLOAD));
    const values = model.expectedMonthlyCredits;
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    expect(near(model.meanMonthlyCredits)).toBe(near(m));
    expect(near(model.coefficientOfVariation)).toBe(near(model.stdDevMonthlyCredits / m));
  });

  it('is zero rather than NaN when there is no demand at all', () => {
    const { model } = scenarioFor(answersWith([]));
    expect(model.coefficientOfVariation).toBe(0);
    expect(model.meanMonthlyCredits).toBe(0);
    expect(model.peakMonthCredits).toBe(0);
    expect(model.peakMonthIndex).toBe(1);
  });
});

describe('scenario audit trail', () => {
  it('records the band formula and the volatility calculation', () => {
    const { trail, model } = scenarioFor(answersWith(FLAT_WORKLOAD));
    const bands = trail.entries.find((e) => e.step === 'scenario:bands');
    expect(bands?.rateCardRef).toBe('modelAssumptions.confidenceMultipliers');
    expect(bands?.output).toBe(model.bands.expected.annualCredits);

    const volatility = trail.entries.find((e) => e.step === 'scenario:volatility');
    expect(volatility?.rateCardRef).toBe('modelAssumptions.volatilityThreshold');
    expect(volatility?.output).toBe(model.coefficientOfVariation);
  });
});
