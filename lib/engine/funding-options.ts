import type {
  AuditValue,
  CostModel,
  CreditModel,
  FundingBreakdownRow,
  FundingOption,
  FundingOptionId,
  LicenceBreakEven,
  NormalisedAnswers,
  RateCard,
  ScenarioModel,
} from './types';
import {
  m365SeatMonthlyUsd,
  p3TierFor,
  p3Tiers,
  packCredits,
  packMonthlyUsd,
  paygCreditUsd,
} from './rate-card';
import type { AuditTrail } from './util';
import { at, percentile, safeDiv, sum } from './util';

/**
 * A customer who tells us a hard capacity stop is acceptable is accepting a tail,
 * not a third of the year. Above this share of annual demand, packs-only stops
 * being a defensible recommendation regardless of stated risk appetite.
 */
const MAX_ACCEPTED_SHORTFALL_SHARE = 0.05;

export interface FundingInput {
  card: RateCard;
  normalised: NormalisedAnswers;
  credits: CreditModel;
  cost: CostModel;
  scenario: ScenarioModel;
  licenceBreakEven: LicenceBreakEven;
  /** Monthly billable credits once every internal user holds a Microsoft 365 Copilot licence. */
  licenceShiftMonthlyCredits: number[];
  /** Extra seats that strategy requires. */
  licenceShiftAdditionalSeats: number;
  /** Monthly billable credits with generative answers served from Azure AI Foundry. */
  byomMonthlyCredits: number[];
  /** Annual Foundry token cost incurred by that swap. */
  byomAnnualTokenCostUsd: number;
}

const ZERO_MONTHS = (): number[] => Array.from({ length: 12 }, () => 0);

/**
 * SPEC §6.5 — all eight funding options, always computed so the comparison table is complete.
 * Ineligible options still carry real numbers, plus the reasons they are ruled out.
 */
export function buildFundingOptions(input: FundingInput, audit: AuditTrail): FundingOption[] {
  const { card, cost, scenario } = input;
  const payg = paygCreditUsd(card);
  const packSize = packCredits(card);
  const packPrice = packMonthlyUsd(card);
  const demand = scenario.expectedMonthlyCredits;
  const conservativeDemand = scenario.conservativeMonthlyCredits;
  const annualDemand = sum(demand);
  const platformBase = cost.platformAnnualUsd;
  const volatile = scenario.coefficientOfVariation > card.modelAssumptions.volatilityThreshold;
  const sizingPercentile = volatile
    ? card.modelAssumptions.packSizingPercentileWhenVolatile
    : card.modelAssumptions.packSizingPercentile;

  const options: FundingOption[] = [
    buildPayg(input, payg, demand, annualDemand, platformBase),
    buildPacksOnly(input, packSize, packPrice, demand, annualDemand, platformBase, sizingPercentile),
    buildPacksPlusPayg(
      input,
      payg,
      packSize,
      packPrice,
      demand,
      annualDemand,
      platformBase,
      sizingPercentile,
      volatile,
    ),
    buildP3PlusPayg(input, payg, demand, conservativeDemand, annualDemand, platformBase),
    buildP3PacksPayg(
      input,
      payg,
      packSize,
      packPrice,
      demand,
      conservativeDemand,
      annualDemand,
      platformBase,
      sizingPercentile,
    ),
    buildLicenceShift(input, payg, platformBase),
    buildByomFoundry(input, payg, platformBase),
    buildDoNothing(input, annualDemand),
  ];

  for (const option of options) {
    audit.record(
      `funding:${option.id}`,
      option.summary,
      {
        creditFundingUsd: option.creditFundingUsd,
        platformCostUsd: option.platformCostUsd,
        purchasedCredits: option.purchasedCredits,
        wasteCredits: option.wasteCredits,
        shortfallCredits: option.shortfallCredits,
        eligible: option.eligible,
      },
      option.twelveMonthTotalUsd,
      'USD over 12 months',
      option.id === 'p3-plus-payg' || option.id === 'p3-packs-payg'
        ? 'p3PrePurchasePlan.tiers'
        : 'commercial',
    );
  }

  return options;
}

/* ------------------------------------------------------------------ */
/* 1. Pay-as-you-go only                                               */
/* ------------------------------------------------------------------ */

function buildPayg(
  input: FundingInput,
  payg: number,
  demand: number[],
  annualDemand: number,
  platformBase: number,
): FundingOption {
  const monthlyCredit = demand.map((c) => c * payg);
  const creditFunding = sum(monthlyCredit);
  return finalise({
    id: 'payg',
    label: 'Pay-as-you-go only',
    summary: 'creditFunding = Σ(monthlyCredits × payAsYouGoCreditPrice); no prepayment, no waste.',
    creditFundingUsd: creditFunding,
    platformCostUsd: platformBase,
    monthlyCreditUsd: monthlyCredit,
    platformMonthlyUsd: platformBase / 12,
    creditsServed: annualDemand,
    purchasedCredits: 0,
    wasteCredits: 0,
    shortfallCredits: 0,
    cashFlowShape: 'monthly-variable',
    commitmentLockInMonths: 0,
    maccEligibility: input.card.maccEligibility.paygCredits,
    reversibility: 'immediate',
    bestWhen:
      'Volume is genuinely unknown, you are still piloting, or you need the freedom to stop at any time.',
    avoidWhen:
      'Consumption is predictable and material — you are paying full retail for capacity you could have discounted.',
    breakdown: [
      { label: 'Metered credit consumption', annualUsd: creditFunding },
      { label: 'Platform and seat costs', annualUsd: platformBase },
    ],
    eligible: true,
    ineligibleReasons: [],
    meta: { usdPerCredit: payg },
  });
}

/* ------------------------------------------------------------------ */
/* 2. Capacity packs only (hard stop)                                  */
/* ------------------------------------------------------------------ */

function buildPacksOnly(
  input: FundingInput,
  packSize: number,
  packPrice: number,
  demand: number[],
  annualDemand: number,
  platformBase: number,
  sizingPercentile: number,
): FundingOption {
  const target = percentile(demand, sizingPercentile);
  const packCount = Math.max(1, Math.ceil(safeDiv(target, packSize)));
  const capacity = packCount * packSize;

  let served = 0;
  let waste = 0;
  let shortfall = 0;
  for (const monthDemand of demand) {
    served += Math.min(capacity, monthDemand);
    waste += Math.max(0, capacity - monthDemand);
    shortfall += Math.max(0, monthDemand - capacity);
  }

  const creditFunding = packCount * packPrice * 12;
  const hardStopAcceptable = input.normalised.answers.growth.budgetTolerance === 'never';
  const ineligibleReasons: string[] = [];
  if (!hardStopAcceptable) {
    ineligibleReasons.push(
      'You told us an overage is acceptable, so a hard capacity stop is a worse fit than pairing packs with a pay-as-you-go safety net.',
    );
  } else if (shortfall > annualDemand * MAX_ACCEPTED_SHORTFALL_SHARE) {
    // Even a customer who accepts a hard stop is not accepting one this large.
    ineligibleReasons.push(
      `Capacity stops at ${Math.round(capacity).toLocaleString('en-US')} credits a month, so ${Math.round(
        shortfall,
      ).toLocaleString('en-US')} credits of forecast demand — ${((shortfall / Math.max(1, annualDemand)) * 100).toFixed(
        1,
      )}% of the year — would simply fail.`,
    );
  }

  return finalise({
    id: 'packs-only',
    label: 'Capacity packs only (hard stop)',
    summary:
      'packCount = ceil(P{pct}(monthlyCredits) ÷ packCredits); creditFunding = packCount × packMonthlyPrice × 12. Unused capacity does not roll over.',
    creditFundingUsd: creditFunding,
    platformCostUsd: platformBase,
    monthlyCreditUsd: demand.map(() => packCount * packPrice),
    platformMonthlyUsd: platformBase / 12,
    creditsServed: served,
    purchasedCredits: capacity * 12,
    wasteCredits: waste,
    shortfallCredits: shortfall,
    cashFlowShape: 'monthly-fixed',
    commitmentLockInMonths: 1,
    maccEligibility: input.card.maccEligibility.capacityPacks,
    reversibility: 'monthly',
    bestWhen:
      'Finance requires an absolutely predictable monthly number and you would rather agents degrade than overspend.',
    avoidWhen:
      'Any month can spike — packs do not roll over, so you pay for the peak every month and still stop dead above it.',
    breakdown: [
      {
        label: `${packCount} × capacity pack`,
        annualUsd: creditFunding,
        note: `${capacity.toLocaleString('en-US')} credits/month, no rollover`,
      },
      { label: 'Platform and seat costs', annualUsd: platformBase },
    ],
    eligible: ineligibleReasons.length === 0,
    ineligibleReasons,
    meta: { packCount, capacityPerMonth: capacity, sizingPercentile },
  });
}

/* ------------------------------------------------------------------ */
/* 3. Capacity packs + pay-as-you-go overage                           */
/* ------------------------------------------------------------------ */

function buildPacksPlusPayg(
  input: FundingInput,
  payg: number,
  packSize: number,
  packPrice: number,
  demand: number[],
  annualDemand: number,
  platformBase: number,
  sizingPercentile: number,
  volatile: boolean,
): FundingOption {
  const target = percentile(demand, sizingPercentile);
  const packCount = Math.max(1, Math.ceil(safeDiv(target, packSize)));
  const capacity = packCount * packSize;

  let waste = 0;
  const monthlyCreditUsd = demand.map((monthDemand) => {
    waste += Math.max(0, capacity - monthDemand);
    const overage = Math.max(0, monthDemand - capacity);
    return packCount * packPrice + overage * payg;
  });
  const overageCredits = sum(demand.map((d) => Math.max(0, d - capacity)));
  const creditFunding = sum(monthlyCreditUsd);

  return finalise({
    id: 'packs-plus-payg',
    label: 'Capacity packs + pay-as-you-go overage',
    summary:
      'packCount = ceil(P{pct}(monthlyCredits) ÷ packCredits); creditFunding = packCount × packMonthlyPrice × 12 + Σ max(0, monthlyCredits − capacity) × payAsYouGoCreditPrice.',
    creditFundingUsd: creditFunding,
    platformCostUsd: platformBase,
    monthlyCreditUsd,
    platformMonthlyUsd: platformBase / 12,
    creditsServed: annualDemand,
    purchasedCredits: capacity * 12,
    wasteCredits: waste,
    shortfallCredits: 0,
    cashFlowShape: 'hybrid',
    commitmentLockInMonths: 1,
    maccEligibility: input.card.maccEligibility.capacityPacks,
    reversibility: 'monthly',
    bestWhen:
      'You have a dependable baseline with occasional spikes — packs discount the base, the meter absorbs the peaks and nothing ever fails.',
    avoidWhen:
      'Demand is so erratic that any pack you buy sits idle most months.',
    breakdown: [
      {
        label: `${packCount} × capacity pack`,
        annualUsd: packCount * packPrice * 12,
        note: `sized at P${sizingPercentile} of monthly demand${volatile ? ' (lowered because your demand is volatile)' : ''}`,
      },
      {
        label: 'Pay-as-you-go overage',
        annualUsd: overageCredits * payg,
        note: `${Math.round(overageCredits).toLocaleString('en-US')} credits above pack capacity`,
      },
      { label: 'Platform and seat costs', annualUsd: platformBase },
    ],
    eligible: true,
    ineligibleReasons: [],
    meta: { packCount, capacityPerMonth: capacity, sizingPercentile, overageCredits },
  });
}

/* ------------------------------------------------------------------ */
/* 4. P3 pre-purchase + pay-as-you-go                                  */
/* ------------------------------------------------------------------ */

interface P3Sizing {
  commitUnits: number;
  discountPct: number;
  discountedUsd: number;
  overflowUsd: number;
  overflowCredits: number;
  wasteCredits: number;
  tierFound: boolean;
  tiersEvaluated: number;
}

function sizeP3(
  input: FundingInput,
  payg: number,
  expectedRetailUsd: number,
  conservativeRetailUsd: number,
): P3Sizing {
  const { card } = input;
  const tiers = p3Tiers(card);
  const tier = p3TierFor(card, conservativeRetailUsd);
  const commitUnits = tier ? conservativeRetailUsd : 0;
  const discountPct = tier?.discountPct ?? 0;
  const discountedUsd = commitUnits * (1 - discountPct / 100);
  const overflowUsd = Math.max(0, expectedRetailUsd - commitUnits);
  return {
    commitUnits,
    discountPct,
    discountedUsd,
    overflowUsd,
    overflowCredits: safeDiv(overflowUsd, payg),
    wasteCredits: safeDiv(Math.max(0, commitUnits - expectedRetailUsd), payg),
    tierFound: tier !== null,
    tiersEvaluated: tiers.length,
  };
}

function p3IneligibleReasons(input: FundingInput, sizing: P3Sizing): string[] {
  const reasons: string[] = [];
  const { normalised, card } = input;
  if (!normalised.answers.growth.canCommitAnnually) {
    reasons.push('You told us you cannot make an annual commitment, and P3 is a non-cancellable annual purchase.');
  }
  if (normalised.confidence === 'low') {
    reasons.push(
      'Your stated forecast confidence is low. Committing money you cannot claw back against a forecast you do not trust is how organisations end up writing off capacity.',
    );
  }
  if (!sizing.tierFound) {
    const smallest = p3Tiers(card)[0];
    reasons.push(
      `Your conservative-band spend does not reach the smallest published pre-purchase tier (${
        smallest ? smallest.commitUnits.toLocaleString('en-US') : '—'
      } units).`,
    );
  }
  return reasons;
}

function buildP3PlusPayg(
  input: FundingInput,
  payg: number,
  demand: number[],
  conservativeDemand: number[],
  annualDemand: number,
  platformBase: number,
): FundingOption {
  const expectedRetail = annualDemand * payg;
  const conservativeRetail = sum(conservativeDemand) * payg;
  const sizing = sizeP3(input, payg, expectedRetail, conservativeRetail);
  const creditFunding = sizing.discountedUsd + sizing.overflowUsd;

  const monthlyCreditUsd = ZERO_MONTHS();
  monthlyCreditUsd[0] = sizing.discountedUsd;
  const commitCredits = safeDiv(sizing.commitUnits, payg);
  let remainingCommit = commitCredits;
  for (let i = 0; i < 12; i += 1) {
    const monthDemand = at(demand, i);
    const covered = Math.min(remainingCommit, monthDemand);
    remainingCommit -= covered;
    monthlyCreditUsd[i] = (monthlyCreditUsd[i] ?? 0) + (monthDemand - covered) * payg;
  }

  const reasons = p3IneligibleReasons(input, sizing);

  return finalise({
    id: 'p3-plus-payg',
    label: 'P3 pre-purchase + pay-as-you-go',
    summary:
      'commit = conservativeBandAnnualRetail; discountedCost = commit × (1 − tierDiscount); creditFunding = discountedCost + max(0, expectedAnnualRetail − commit).',
    creditFundingUsd: creditFunding,
    platformCostUsd: platformBase,
    monthlyCreditUsd,
    platformMonthlyUsd: platformBase / 12,
    creditsServed: annualDemand,
    purchasedCredits: commitCredits,
    wasteCredits: sizing.wasteCredits,
    shortfallCredits: 0,
    cashFlowShape: 'annual-upfront',
    commitmentLockInMonths: input.card.p3PrePurchasePlan.termMonths,
    maccEligibility: input.card.maccEligibility.p3PrePurchase,
    reversibility: 'annual-locked',
    bestWhen:
      'Demand is proven and stable, you can commit for a year, and the discount is worth surrendering the option to stop.',
    avoidWhen:
      'Forecast confidence is low or budget approval is uncertain — unused pre-purchase is non-refundable and does not roll over at term end.',
    breakdown: [
      {
        label: `P3 pre-purchase (${sizing.discountPct}% discount)`,
        annualUsd: sizing.discountedUsd,
        note: `${Math.round(sizing.commitUnits).toLocaleString('en-US')} units committed, non-cancellable`,
      },
      {
        label: 'Pay-as-you-go above commitment',
        annualUsd: sizing.overflowUsd,
        note: `${Math.round(sizing.overflowCredits).toLocaleString('en-US')} credits`,
      },
      { label: 'Platform and seat costs', annualUsd: platformBase },
    ],
    eligible: reasons.length === 0,
    ineligibleReasons: reasons,
    meta: {
      commitUnits: sizing.commitUnits,
      discountPct: sizing.discountPct,
      tiersEvaluated: sizing.tiersEvaluated,
    },
  });
}

/* ------------------------------------------------------------------ */
/* 5. P3 + packs + pay-as-you-go (three-tier waterfall)                */
/* ------------------------------------------------------------------ */

function buildP3PacksPayg(
  input: FundingInput,
  payg: number,
  packSize: number,
  packPrice: number,
  demand: number[],
  conservativeDemand: number[],
  annualDemand: number,
  platformBase: number,
  sizingPercentile: number,
): FundingOption {
  const target = percentile(demand, sizingPercentile);
  const packCount = Math.max(1, Math.ceil(safeDiv(target, packSize)));
  const capacity = packCount * packSize;

  const residualExpected = demand.map((d) => Math.max(0, d - capacity));
  const residualConservative = conservativeDemand.map((d) => Math.max(0, d - capacity));
  const packWaste = sum(demand.map((d) => Math.max(0, capacity - d)));

  const sizing = sizeP3(
    input,
    payg,
    sum(residualExpected) * payg,
    sum(residualConservative) * payg,
  );

  const packAnnual = packCount * packPrice * 12;
  const creditFunding = packAnnual + sizing.discountedUsd + sizing.overflowUsd;

  const monthlyCreditUsd = ZERO_MONTHS();
  monthlyCreditUsd[0] = sizing.discountedUsd;
  let remainingCommit = safeDiv(sizing.commitUnits, payg);
  for (let i = 0; i < 12; i += 1) {
    const residual = at(residualExpected, i);
    const covered = Math.min(remainingCommit, residual);
    remainingCommit -= covered;
    monthlyCreditUsd[i] = (monthlyCreditUsd[i] ?? 0) + packCount * packPrice + (residual - covered) * payg;
  }

  const reasons = p3IneligibleReasons(input, sizing);

  return finalise({
    id: 'p3-packs-payg',
    label: 'P3 + capacity packs + pay-as-you-go',
    summary:
      'Waterfall: packs absorb the baseline, the pre-purchase commitment absorbs the predictable residual, the meter absorbs whatever is left.',
    creditFundingUsd: creditFunding,
    platformCostUsd: platformBase,
    monthlyCreditUsd,
    platformMonthlyUsd: platformBase / 12,
    creditsServed: annualDemand,
    purchasedCredits: capacity * 12 + safeDiv(sizing.commitUnits, payg),
    wasteCredits: packWaste + sizing.wasteCredits,
    shortfallCredits: 0,
    cashFlowShape: 'hybrid',
    commitmentLockInMonths: input.card.p3PrePurchasePlan.termMonths,
    maccEligibility: input.card.maccEligibility.p3PrePurchase,
    reversibility: 'annual-locked',
    bestWhen:
      'You have a large, layered estate: a stable floor worth packing, a predictable middle worth committing, and a spiky top worth metering.',
    avoidWhen:
      'The estate is small enough that three instruments is administrative overhead for a rounding error.',
    breakdown: [
      { label: `${packCount} × capacity pack (baseline)`, annualUsd: packAnnual },
      {
        label: `P3 pre-purchase on residual (${sizing.discountPct}% discount)`,
        annualUsd: sizing.discountedUsd,
      },
      { label: 'Pay-as-you-go on the remainder', annualUsd: sizing.overflowUsd },
      { label: 'Platform and seat costs', annualUsd: platformBase },
    ],
    eligible: reasons.length === 0,
    ineligibleReasons: reasons,
    meta: {
      packCount,
      capacityPerMonth: capacity,
      commitUnits: sizing.commitUnits,
      discountPct: sizing.discountPct,
    },
  });
}

/* ------------------------------------------------------------------ */
/* 6. Licence shift                                                    */
/* ------------------------------------------------------------------ */

function buildLicenceShift(
  input: FundingInput,
  payg: number,
  platformBase: number,
): FundingOption {
  const { card, licenceShiftMonthlyCredits, licenceShiftAdditionalSeats, licenceBreakEven } = input;
  const seatMonthly = m365SeatMonthlyUsd(card);
  const seatAnnual = licenceShiftAdditionalSeats * seatMonthly * 12;
  const monthlyCreditUsd = licenceShiftMonthlyCredits.map((c) => c * payg);
  const creditFunding = sum(monthlyCreditUsd);
  const creditsServed = sum(licenceShiftMonthlyCredits);

  const reasons: string[] = [];
  if (licenceShiftAdditionalSeats === 0) {
    reasons.push('Every internal user already holds a Microsoft 365 Copilot licence, so there is no shift left to make.');
  }
  if (!licenceBreakEven.worthwhile && licenceShiftAdditionalSeats > 0) {
    reasons.push(
      'Per-user consumption sits below the seat break-even, so buying seats purely to zero-rate agent traffic costs more than it removes.',
    );
  }

  return finalise({
    id: 'licence-shift',
    label: 'Licence shift (zero-rate internal traffic)',
    summary:
      'Buy Microsoft 365 Copilot seats so internal core agent activity is included; meter only external and non-offsettable traffic.',
    creditFundingUsd: creditFunding,
    platformCostUsd: platformBase + seatAnnual,
    monthlyCreditUsd,
    platformMonthlyUsd: (platformBase + seatAnnual) / 12,
    creditsServed,
    purchasedCredits: 0,
    wasteCredits: 0,
    shortfallCredits: 0,
    cashFlowShape: 'hybrid',
    commitmentLockInMonths: 12,
    maccEligibility: card.maccEligibility.m365CopilotSeats,
    reversibility: 'annual-locked',
    bestWhen:
      'Consumption is dominated by internal knowledge workers who each generate more than the seat break-even, and you want the productivity value anyway.',
    avoidWhen:
      'Traffic is customer-facing or machine-driven — no licence can offset it, and you would be buying seats nobody uses.',
    breakdown: [
      {
        label: `${licenceShiftAdditionalSeats.toLocaleString('en-US')} × Microsoft 365 Copilot seat`,
        annualUsd: seatAnnual,
        note: `$${seatMonthly}/user/month, typically an annual commitment`,
      },
      {
        label: 'Residual metered traffic (external + non-offsettable)',
        annualUsd: creditFunding,
      },
      { label: 'Existing platform and seat costs', annualUsd: platformBase },
    ],
    eligible: reasons.length === 0,
    ineligibleReasons: reasons,
    meta: {
      additionalSeats: licenceShiftAdditionalSeats,
      breakEvenCredits: licenceBreakEven.breakEvenCreditsAtPayg,
      annualNetBenefitUsd: licenceBreakEven.annualNetBenefitUsd,
    },
  });
}

/* ------------------------------------------------------------------ */
/* 7. Bring your own model (Azure AI Foundry)                          */
/* ------------------------------------------------------------------ */

function buildByomFoundry(
  input: FundingInput,
  payg: number,
  platformBase: number,
): FundingOption {
  const { card, byomMonthlyCredits, byomAnnualTokenCostUsd, credits } = input;
  const monthlyCreditUsd = byomMonthlyCredits.map((c) => c * payg);
  const creditFunding = sum(monthlyCreditUsd);
  const creditsServed = sum(byomMonthlyCredits);

  const reasons: string[] = [];
  if (byomAnnualTokenCostUsd === 0) {
    reasons.push(
      'None of your selected workloads generate model responses that could be served from your own Foundry deployment.',
    );
  }
  if (input.normalised.answers.growth.costAttributionPerBu && byomAnnualTokenCostUsd > 0) {
    reasons.push(
      'You need per-business-unit cost attribution. Serving traffic from a shared Foundry deployment makes that attribution harder, not easier, unless you split deployments per business unit.',
    );
  }

  return finalise({
    id: 'byom-foundry',
    label: 'Bring your own model (Azure AI Foundry)',
    summary:
      'Serve generative responses from your own Foundry deployment; pay Azure token rates instead of credit rates for that traffic.',
    creditFundingUsd: creditFunding,
    platformCostUsd: platformBase + byomAnnualTokenCostUsd,
    monthlyCreditUsd,
    platformMonthlyUsd: (platformBase + byomAnnualTokenCostUsd) / 12,
    creditsServed,
    purchasedCredits: 0,
    wasteCredits: 0,
    shortfallCredits: 0,
    cashFlowShape: 'monthly-variable',
    commitmentLockInMonths: 0,
    maccEligibility: card.maccEligibility.foundryTokens,
    reversibility: 'immediate',
    bestWhen:
      'Generative volume is very high, you already run Azure AI Foundry, and you have the engineering capacity to own model operations.',
    avoidWhen:
      'You want a managed experience — this trades a higher unit price for operational responsibility you may not want.',
    breakdown: [
      { label: 'Azure AI Foundry token consumption', annualUsd: byomAnnualTokenCostUsd },
      { label: 'Residual metered credits', annualUsd: creditFunding },
      { label: 'Existing platform and seat costs', annualUsd: platformBase },
    ],
    eligible: reasons.length === 0,
    ineligibleReasons: reasons,
    meta: {
      generativeCreditsRemoved: credits.billableCredits * 12 - creditsServed,
      foundryAnnualTokenCostUsd: byomAnnualTokenCostUsd,
    },
  });
}

/* ------------------------------------------------------------------ */
/* 8. Do nothing                                                       */
/* ------------------------------------------------------------------ */

function buildDoNothing(input: FundingInput, annualDemand: number): FundingOption {
  return finalise({
    id: 'do-nothing',
    label: 'Do nothing (deliberate baseline)',
    summary: 'No funding instrument is put in place; the modelled capability is simply not delivered.',
    creditFundingUsd: 0,
    platformCostUsd: 0,
    monthlyCreditUsd: ZERO_MONTHS(),
    platformMonthlyUsd: 0,
    creditsServed: 0,
    purchasedCredits: 0,
    wasteCredits: 0,
    shortfallCredits: annualDemand,
    cashFlowShape: 'none',
    commitmentLockInMonths: 0,
    maccEligibility: 'no',
    reversibility: 'n/a',
    bestWhen:
      'The business case has not been made. Keeping this on the table stops the exercise becoming a foregone conclusion.',
    avoidWhen:
      'Teams are already consuming credits — doing nothing then means an unbudgeted invoice, not a saving.',
    breakdown: [
      {
        label: 'Capability not delivered',
        annualUsd: 0,
        note: `${Math.round(annualDemand).toLocaleString('en-US')} credits of forecast demand goes unserved`,
      },
    ],
    eligible: true,
    ineligibleReasons: [],
    meta: { unservedCredits: annualDemand, sizedAgainstWorkloads: input.normalised.activeWorkloads.length },
  });
}

/* ------------------------------------------------------------------ */
/* Shared finalisation                                                 */
/* ------------------------------------------------------------------ */

interface DraftOption {
  id: FundingOptionId;
  label: string;
  summary: string;
  creditFundingUsd: number;
  platformCostUsd: number;
  monthlyCreditUsd: number[];
  platformMonthlyUsd: number;
  creditsServed: number;
  purchasedCredits: number;
  wasteCredits: number;
  shortfallCredits: number;
  cashFlowShape: FundingOption['cashFlowShape'];
  commitmentLockInMonths: number;
  maccEligibility: FundingOption['maccEligibility'];
  reversibility: FundingOption['reversibility'];
  bestWhen: string;
  avoidWhen: string;
  breakdown: FundingBreakdownRow[];
  eligible: boolean;
  ineligibleReasons: string[];
  meta?: Record<string, AuditValue>;
}

function finalise(draft: DraftOption): FundingOption {
  const monthlyUsd = draft.monthlyCreditUsd.map((v) => v + draft.platformMonthlyUsd);
  const twelveMonthTotalUsd = draft.creditFundingUsd + draft.platformCostUsd;
  const totalDemand = draft.creditsServed + draft.shortfallCredits;
  return {
    id: draft.id,
    label: draft.label,
    summary: draft.summary,
    twelveMonthTotalUsd,
    creditFundingUsd: draft.creditFundingUsd,
    platformCostUsd: draft.platformCostUsd,
    peakMonthUsd: monthlyUsd.length === 0 ? 0 : Math.max(...monthlyUsd),
    effectiveUsdPerCredit: safeDiv(draft.creditFundingUsd, draft.creditsServed),
    creditsServed: draft.creditsServed,
    purchasedCredits: draft.purchasedCredits,
    wasteCredits: draft.wasteCredits,
    wasteUsd: safeDiv(draft.creditFundingUsd, draft.purchasedCredits) * draft.wasteCredits,
    wastePctOfPurchased: safeDiv(draft.wasteCredits, draft.purchasedCredits) * 100,
    shortfallCredits: draft.shortfallCredits,
    shortfallRiskPct: safeDiv(draft.shortfallCredits, totalDemand) * 100,
    cashFlowShape: draft.cashFlowShape,
    commitmentLockInMonths: draft.commitmentLockInMonths,
    maccEligibility: draft.maccEligibility,
    reversibility: draft.reversibility,
    bestWhen: draft.bestWhen,
    avoidWhen: draft.avoidWhen,
    breakdown: draft.breakdown,
    eligible: draft.eligible,
    ineligibleReasons: draft.ineligibleReasons,
    monthlyUsd,
    meta: draft.meta,
  };
}
