import type { Answers } from '@/lib/schemas/answers';
import type {
  CostModel,
  CreditModel,
  EngineResult,
  FundingOption,
  LicenceBreakEven,
  NormalisedAnswers,
  RateCard,
  Recommendation,
  RiskItem,
  ScenarioModel,
  VolumeModel,
} from './types';
import { getRateCard, paygCreditUsd, unverifiedRows } from './rate-card';
import { normalise } from './normalise';
import { buildVolumeModel } from './volume-model';
import { buildCreditModel } from './credit-model';
import { buildCostModel } from './cost-model';
import { buildScenarioModel } from './scenario-band';
import { buildLicenceBreakEven } from './licence-break-even';
import { buildFundingOptions } from './funding-options';
import { buildRecommendation } from './recommendation';
import { buildSensitivity } from './sensitivity';
import { createAuditTrail, sum } from './util';
import type { AuditTrail } from './util';

export interface CoreResult {
  normalised: NormalisedAnswers;
  volume: VolumeModel;
  credits: CreditModel;
  cost: CostModel;
  scenario: ScenarioModel;
  licenceBreakEven: LicenceBreakEven;
  fundingOptions: FundingOption[];
  recommendation: Recommendation;
  audit: AuditTrail;
}

/**
 * The full pipeline: normalise → volume → credits → cost → scenario → break-even →
 * funding → recommendation. Pure and deterministic; the same answers always produce
 * the same numbers and the same audit trail.
 */
export function runCore(answers: Answers, card: RateCard): CoreResult {
  const audit = createAuditTrail();

  const normalised = normalise(answers, audit);
  const volume = buildVolumeModel(normalised, card, audit);
  const credits = buildCreditModel(volume, card, audit);
  const cost = buildCostModel(credits, normalised, card, audit);
  const scenario = buildScenarioModel(credits, normalised, card, audit);
  const licenceBreakEven = buildLicenceBreakEven(credits, normalised, card, audit);

  // Variant A — the licence shift. Licensing *every* internal user is the ceiling; the
  // economically rational move is to license only those whose own consumption clears the
  // seat price, so that is what the funding option is sized on.
  const shiftAudit = createAuditTrail();
  const shiftCredits = buildCreditModel(volume, card, shiftAudit, {
    assumeAllInternalLicensed: true,
  });
  const licenceCeilingCredits = credits.billableCredits - shiftCredits.billableCredits;
  const targetedRemoval = Math.min(
    licenceBreakEven.creditsRemovedByTargetedShift,
    licenceCeilingCredits,
  );
  const shiftFactor =
    credits.billableCredits <= 0 ? 1 : Math.max(0, 1 - targetedRemoval / credits.billableCredits);
  const additionalSeats = licenceBreakEven.usersAboveBreakEven;

  audit.record(
    'licence-shift',
    'ceiling = billableCredits − billableCredits(allInternalLicensed); targeted = min(creditsRemovedByTargetedShift, ceiling); shiftFactor = 1 − targeted ÷ billableCredits',
    {
      billableCredits: credits.billableCredits,
      licenceCeilingCredits,
      creditsRemovedByTargetedShift: licenceBreakEven.creditsRemovedByTargetedShift,
      targetedRemoval,
      usersAboveBreakEven: additionalSeats,
    },
    shiftFactor,
    'factor',
    'commercial.m365CopilotSeat',
  );

  // Variant B — generative answers served from a Foundry deployment (BYOM).
  const byomAudit = createAuditTrail();
  const byomCredits = buildCreditModel(volume, card, byomAudit, { byomZeroRateGenerative: true });
  const byomScenario = buildScenarioModel(byomCredits, normalised, card, byomAudit);
  const byomAnnualTokenCostUsd = foundryTokenCostForGenerativeAnswers(volume, card, scenario);

  const fundingOptions = buildFundingOptions(
    {
      card,
      normalised,
      credits,
      cost,
      scenario,
      licenceBreakEven,
      licenceShiftMonthlyCredits: scenario.expectedMonthlyCredits.map((c) => c * shiftFactor),
      licenceShiftAdditionalSeats: additionalSeats,
      byomMonthlyCredits: byomScenario.expectedMonthlyCredits,
      byomAnnualTokenCostUsd,
    },
    audit,
  );

  const recommendation = buildRecommendation(
    fundingOptions,
    scenario,
    normalised,
    licenceBreakEven,
    card,
    audit,
  );

  return {
    normalised,
    volume,
    credits,
    cost,
    scenario,
    licenceBreakEven,
    fundingOptions,
    recommendation,
    audit,
  };
}

/**
 * Annual Azure token cost of serving every modelled generative answer from Foundry
 * instead of the Copilot credit meter.
 */
function foundryTokenCostForGenerativeAnswers(
  volume: VolumeModel,
  card: RateCard,
  scenario: ScenarioModel,
): number {
  const answersPerMonth = volume.lines
    .filter((l) => l.rateId === 'generative-answer')
    .reduce((acc, l) => acc + l.quantity, 0);
  if (answersPerMonth === 0) return 0;

  const { byomInputTokensPerGenerativeAnswer, byomOutputTokensPerGenerativeAnswer } =
    card.modelAssumptions;
  // Scale by the same ramp/seasonality curve the credit projection uses.
  const rampScale =
    scenario.expectedMonthlyCredits.length === 0
      ? 0
      : sum(scenario.expectedMonthlyCredits) /
        Math.max(1e-9, scenario.expectedMonthlyCredits.length * scenario.bands.expected.monthlyCredits);

  const annualAnswers = answersPerMonth * 12 * (Number.isFinite(rampScale) ? rampScale : 1);
  const inputTokens = annualAnswers * byomInputTokensPerGenerativeAnswer;
  const outputTokens = annualAnswers * byomOutputTokensPerGenerativeAnswer;

  return (
    (inputTokens / 1_000_000) * card.commercial.foundry.inputPerMillionTokensUsd +
    (outputTokens / 1_000_000) * card.commercial.foundry.outputPerMillionTokensUsd
  );
}

export function buildRisks(core: CoreResult, card: RateCard): RiskItem[] {
  const risks: RiskItem[] = [];
  const primary = core.fundingOptions.find((o) => o.id === core.recommendation.primary.optionId);
  const payg = paygCreditUsd(card);

  if (primary && primary.shortfallRiskPct > 0) {
    risks.push({
      id: 'shortfall',
      title: 'Capacity shortfall',
      severity: primary.shortfallRiskPct > 10 ? 'high' : 'medium',
      description: `${primary.shortfallRiskPct.toFixed(1)}% of forecast demand exceeds the purchased capacity under the recommended plan. Agents stop rather than degrade when capacity runs out.`,
      mitigation:
        'Attach a pay-as-you-go overage policy, or raise the prepaid tier so the peak month is covered.',
    });
  }

  if (primary && primary.commitmentLockInMonths >= 12) {
    risks.push({
      id: 'non-cancellable-commitment',
      title: 'Non-cancellable commitment',
      severity: core.normalised.confidence === 'high' ? 'medium' : 'high',
      description: `The recommended plan locks in ${primary.commitmentLockInMonths} months. ${card.p3PrePurchasePlan.note}`,
      mitigation:
        'Size the commitment against the Conservative band only, and keep the marginal volume on the meter where you can stop it.',
    });
  }

  if (core.credits.externalBillableCredits > 0) {
    risks.push({
      id: 'external-exposure',
      title: 'External traffic exposure',
      severity: core.credits.externalBillableCredits > core.credits.billableCredits * 0.5 ? 'high' : 'medium',
      description: `${Math.round(core.credits.externalBillableCredits).toLocaleString('en-US')} credits a month (about $${Math.round(core.credits.externalBillableCredits * payg).toLocaleString('en-US')}) come from external or customer-facing traffic. No licence can ever offset that, and volume is driven by your customers rather than by you.`,
      mitigation:
        'Put per-conversation guardrails and a monthly credit policy on customer-facing agents before you expose them at scale.',
    });
  }

  const unverified = unverifiedRows(card);
  risks.push({
    id: 'rate-change',
    title: 'Rate-card change exposure',
    severity: unverified.length > 4 ? 'high' : 'medium',
    description: `Every figure here is modelled against rate card ${card.version} (effective ${card.effectiveDate}). ${unverified.length} of the rows used are not directly verifiable against public Microsoft documentation and are marked unverified in the app. Microsoft changes consumption rates and commercial terms without notice.`,
    mitigation:
      'Treat this as a planning estimate, re-run it against the current rate card before any purchase, and confirm pricing with your Microsoft account team.',
  });

  if (core.normalised.defaultedWorkloads.length > 0) {
    risks.push({
      id: 'defaulted-inputs',
      title: 'Estimate rests on defaults',
      severity: core.normalised.defaultedWorkloads.length > 2 ? 'high' : 'low',
      description: `${core.normalised.defaultedWorkloads.length} selected workload${core.normalised.defaultedWorkloads.length === 1 ? ' was' : 's were'} left at our default assumptions rather than your own numbers.`,
      mitigation: 'Replace the defaults with observed telemetry before presenting this to a budget holder.',
    });
  }

  if (core.normalised.confidence === 'low') {
    risks.push({
      id: 'low-confidence',
      title: 'Low forecast confidence',
      severity: 'high',
      description:
        'You told us confidence in these volumes is low, so the Conservative-to-Aggressive band is deliberately wide. The spread, not the midpoint, is the planning number.',
      mitigation:
        'Instrument a 90-day pilot and re-run this with observed volumes before committing to anything non-cancellable.',
    });
  }

  return risks;
}

/** Runs the full engine, including the ±20% sensitivity sweep. */
export function runEngine(answers: Answers, card: RateCard = getRateCard()): EngineResult {
  const core = runCore(answers, card);
  const baselineTotal = core.recommendation.primary.twelveMonthTotalUsd;
  const primaryId = core.recommendation.primary.optionId;

  // Perturb the *normalised* answers: the raw answers may leave usage objects empty and
  // rely on per-workload defaults, and there is nothing to vary in an absent object.
  const sensitivity = buildSensitivity(
    core.normalised.answers,
    card,
    baselineTotal,
    (perturbed) => {
      const run = runCore(perturbed, card);
      const same = run.fundingOptions.find((o) => o.id === primaryId);
      return same?.twelveMonthTotalUsd ?? run.recommendation.primary.twelveMonthTotalUsd;
    },
  );

  return {
    rateCardVersion: card.version,
    rateCardEffectiveDate: card.effectiveDate,
    currency: card.currency,
    normalised: core.normalised,
    volume: core.volume,
    credits: core.credits,
    cost: core.cost,
    scenario: core.scenario,
    licenceBreakEven: core.licenceBreakEven,
    fundingOptions: core.fundingOptions,
    recommendation: core.recommendation,
    sensitivity,
    risks: buildRisks(core, card),
    audit: core.audit.entries,
  };
}

/** Cheap variant used by the wizard's live running estimate — no sensitivity sweep. */
export function runEstimate(
  answers: Answers,
  card: RateCard = getRateCard(),
): {
  monthlyCredits: number;
  monthlyCostUsd: number;
  annualCostUsd: number;
  conservativeMonthlyCredits: number;
  aggressiveMonthlyCredits: number;
  rateCardVersion: string;
} {
  const core = runCore(answers, card);
  return {
    monthlyCredits: core.scenario.bands.expected.monthlyCredits,
    monthlyCostUsd: core.cost.totalMonthlyUsd,
    annualCostUsd: core.recommendation.primary.twelveMonthTotalUsd,
    conservativeMonthlyCredits: core.scenario.bands.conservative.monthlyCredits,
    aggressiveMonthlyCredits: core.scenario.bands.aggressive.monthlyCredits,
    rateCardVersion: card.version,
  };
}

export * from './types';
export { getRateCard, unverifiedRows } from './rate-card';
