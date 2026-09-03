import type {
  BandName,
  CreditModel,
  MonthlyPoint,
  NormalisedAnswers,
  RateCard,
  ScenarioBand,
  ScenarioModel,
} from './types';
import { paygCreditUsd } from './rate-card';
import type { AuditTrail } from './util';
import { at, coefficientOfVariation, mean, stdDev, sum } from './util';

const MONTH_LABELS = [
  'Month 1',
  'Month 2',
  'Month 3',
  'Month 4',
  'Month 5',
  'Month 6',
  'Month 7',
  'Month 8',
  'Month 9',
  'Month 10',
  'Month 11',
  'Month 12',
];

/**
 * SPEC §6.4 — Conservative / Expected / Aggressive bands driven by the user's stated
 * confidence, projected over 12 months through the adoption ramp and seasonality curve.
 */
export function buildScenarioModel(
  credits: CreditModel,
  normalised: NormalisedAnswers,
  card: RateCard,
  audit: AuditTrail,
): ScenarioModel {
  const multipliers = card.modelAssumptions.confidenceMultipliers[normalised.confidence];
  const payg = paygCreditUsd(card);
  const steadyState = credits.billableCredits;

  const curveFor = (multiplier: number): number[] =>
    Array.from({ length: 12 }, (_, i) =>
      Math.max(
        0,
        steadyState * at(normalised.rampFactors, i) * at(normalised.seasonalityFactors, i) * multiplier,
      ),
    );

  const conservativeMonthlyCredits = curveFor(multipliers.conservative);
  const expectedMonthlyCredits = curveFor(multipliers.expected);
  const aggressiveMonthlyCredits = curveFor(multipliers.aggressive);

  const months: MonthlyPoint[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: MONTH_LABELS[i] ?? `Month ${i + 1}`,
    rampFactor: at(normalised.rampFactors, i),
    seasonalityFactor: at(normalised.seasonalityFactors, i),
    conservativeCredits: at(conservativeMonthlyCredits, i),
    expectedCredits: at(expectedMonthlyCredits, i),
    aggressiveCredits: at(aggressiveMonthlyCredits, i),
  }));

  const band = (name: BandName, multiplier: number, curve: number[]): ScenarioBand => {
    const annualCredits = sum(curve);
    const monthlyCredits = steadyState * multiplier;
    return {
      name,
      multiplier,
      monthlyCredits,
      annualCredits,
      monthlyCreditCostUsd: monthlyCredits * payg,
      annualCreditCostUsd: annualCredits * payg,
    };
  };

  const bands: Record<BandName, ScenarioBand> = {
    conservative: band('conservative', multipliers.conservative, conservativeMonthlyCredits),
    expected: band('expected', multipliers.expected, expectedMonthlyCredits),
    aggressive: band('aggressive', multipliers.aggressive, aggressiveMonthlyCredits),
  };

  const meanMonthlyCredits = mean(expectedMonthlyCredits);
  const stdDevMonthlyCredits = stdDev(expectedMonthlyCredits);
  const cv = coefficientOfVariation(expectedMonthlyCredits);

  let peakMonthIndex = 0;
  for (let i = 1; i < expectedMonthlyCredits.length; i += 1) {
    if (at(expectedMonthlyCredits, i) > at(expectedMonthlyCredits, peakMonthIndex)) {
      peakMonthIndex = i;
    }
  }

  audit.record(
    'scenario:bands',
    'monthlyCredits(band, m) = steadyStateBillableCredits × rampFactor(m) × seasonalityFactor(m) × confidenceMultiplier(band)',
    {
      steadyStateBillableCredits: steadyState,
      confidence: normalised.confidence,
      conservativeMultiplier: multipliers.conservative,
      expectedMultiplier: multipliers.expected,
      aggressiveMultiplier: multipliers.aggressive,
    },
    bands.expected.annualCredits,
    'credits over 12 months (expected)',
    'modelAssumptions.confidenceMultipliers',
  );

  audit.record(
    'scenario:volatility',
    'coefficientOfVariation = stdDev(monthlyCredits) ÷ mean(monthlyCredits)',
    { meanMonthlyCredits, stdDevMonthlyCredits },
    cv,
    'ratio',
    'modelAssumptions.volatilityThreshold',
  );

  return {
    bands,
    months,
    expectedMonthlyCredits,
    conservativeMonthlyCredits,
    aggressiveMonthlyCredits,
    meanMonthlyCredits,
    stdDevMonthlyCredits,
    coefficientOfVariation: cv,
    peakMonthCredits: at(expectedMonthlyCredits, peakMonthIndex),
    peakMonthIndex: peakMonthIndex + 1,
  };
}
