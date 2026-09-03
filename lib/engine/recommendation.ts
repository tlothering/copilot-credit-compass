import type {
  FundingOption,
  FundingOptionId,
  LicenceBreakEven,
  NormalisedAnswers,
  RankedOption,
  RateCard,
  Recommendation,
  RuleOutcome,
  ScenarioModel,
} from './types';
import type { AuditTrail } from './util';
import { roundUsd, safeDiv, sum } from './util';

const PREPAID_OPTIONS: FundingOptionId[] = [
  'packs-only',
  'packs-plus-payg',
  'p3-plus-payg',
  'p3-packs-payg',
];

const usd = (v: number): string =>
  `$${Math.round(roundUsd(v)).toLocaleString('en-US')}`;

/**
 * SPEC §6.6 — the seven recommendation rules, encoded explicitly so the reasoning
 * can be rendered rather than asserted.
 */
export function buildRecommendation(
  options: FundingOption[],
  scenario: ScenarioModel,
  normalised: NormalisedAnswers,
  licenceBreakEven: LicenceBreakEven,
  card: RateCard,
  audit: AuditTrail,
): Recommendation {
  const byId = new Map(options.map((o) => [o.id, o]));
  const annualDemand = sum(scenario.expectedMonthlyCredits);
  const rules: RuleOutcome[] = [];
  const disqualified = new Map<FundingOptionId, string>();
  const multipliers = new Map<FundingOptionId, number>();

  const penalise = (id: FundingOptionId, factor: number): void => {
    multipliers.set(id, (multipliers.get(id) ?? 1) * factor);
  };

  /* ---- Rule 1: volatility ---------------------------------------- */
  const cv = scenario.coefficientOfVariation;
  const volatile = cv > card.modelAssumptions.volatilityThreshold;
  if (volatile) {
    for (const id of ['p3-plus-payg', 'p3-packs-payg'] as FundingOptionId[]) {
      penalise(id, 1 + cv);
    }
    penalise('packs-only', 1 + cv);
  }
  rules.push({
    id: 'volatility',
    name: 'Volatility test',
    fired: volatile,
    reason: volatile
      ? `Month-to-month demand varies by a coefficient of variation of ${cv.toFixed(2)}, above the ${card.modelAssumptions.volatilityThreshold} threshold.`
      : `Month-to-month demand is stable (coefficient of variation ${cv.toFixed(2)}, at or below the ${card.modelAssumptions.volatilityThreshold} threshold).`,
    effect: volatile
      ? `Weighted toward pay-as-you-go and sized any capacity packs at the P${card.modelAssumptions.packSizingPercentileWhenVolatile} of demand rather than the P${card.modelAssumptions.packSizingPercentile}.`
      : `Capacity packs sized at the P${card.modelAssumptions.packSizingPercentile} of demand.`,
    evidence: {
      coefficientOfVariation: cv,
      threshold: card.modelAssumptions.volatilityThreshold,
      meanMonthlyCredits: scenario.meanMonthlyCredits,
      stdDevMonthlyCredits: scenario.stdDevMonthlyCredits,
    },
  });

  /* ---- Rule 2: waste --------------------------------------------- */
  const wasteThreshold = card.modelAssumptions.maxAcceptableWastePct;
  const wasteful = options.filter(
    (o) => o.purchasedCredits > 0 && o.wastePctOfPurchased > wasteThreshold,
  );
  for (const option of wasteful) {
    disqualified.set(
      option.id,
      `${option.wastePctOfPurchased.toFixed(1)}% of the credits you would prepay go unused, above the ${wasteThreshold}% limit. Capacity packs do not roll over.`,
    );
  }
  rules.push({
    id: 'waste',
    name: 'Waste test',
    fired: wasteful.length > 0,
    reason:
      wasteful.length > 0
        ? `${wasteful.length} prepaid option${wasteful.length === 1 ? '' : 's'} would leave more than ${wasteThreshold}% of purchased credits unused.`
        : `No prepaid option leaves more than ${wasteThreshold}% of purchased credits unused.`,
    effect:
      wasteful.length > 0
        ? `Disqualified: ${wasteful.map((o) => o.label).join(', ')}.`
        : 'No option disqualified on waste.',
    evidence: Object.fromEntries(
      options
        .filter((o) => o.purchasedCredits > 0)
        .map((o) => [`${o.id}WastePct`, Number(o.wastePctOfPurchased.toFixed(2))]),
    ),
  });

  /* ---- Rule 3: commit -------------------------------------------- */
  const p3 = byId.get('p3-plus-payg');
  const commitBlocked = p3 ? !p3.eligible : true;
  if (commitBlocked) {
    for (const id of ['p3-plus-payg', 'p3-packs-payg'] as FundingOptionId[]) {
      const option = byId.get(id);
      disqualified.set(
        id,
        option?.ineligibleReasons[0] ??
          'Pre-purchase requires an annual commitment you told us you cannot make.',
      );
    }
  }
  rules.push({
    id: 'commit',
    name: 'Commit test',
    fired: commitBlocked,
    reason: commitBlocked
      ? (p3?.ineligibleReasons.join(' ') ?? 'Pre-purchase preconditions are not met.')
      : 'Conservative-band spend clears a published pre-purchase tier, you can commit annually, and your forecast confidence is not low.',
    effect: commitBlocked
      ? 'Pre-purchase options are shown for completeness but excluded from the recommendation.'
      : `Pre-purchase is eligible at a ${String(p3?.meta?.discountPct ?? 0)}% discount.`,
    evidence: {
      canCommitAnnually: normalised.answers.growth.canCommitAnnually,
      confidence: normalised.confidence,
      conservativeAnnualCredits: scenario.bands.conservative.annualCredits,
      commitUnits: Number(p3?.meta?.commitUnits ?? 0),
    },
  });

  /* ---- Rule 4: MACC ---------------------------------------------- */
  const macc = normalised.answers.growth.hasUnspentAzureCommitment;
  if (macc) {
    for (const option of options) {
      if (option.maccEligibility !== 'no') penalise(option.id, 0.95);
    }
  }
  rules.push({
    id: 'macc',
    name: 'MACC test',
    fired: macc,
    reason: macc
      ? 'You told us you hold unspent Azure commitment that needs burning down.'
      : 'No unspent Azure commitment was declared.',
    effect: macc
      ? 'Weighted toward options that may draw down Azure commitment. Eligibility is not guaranteed — confirm with your Microsoft account team before relying on it.'
      : 'No commitment burn-down weighting applied.',
    evidence: {
      hasUnspentAzureCommitment: macc,
      paygEligibility: card.maccEligibility.paygCredits,
      p3Eligibility: card.maccEligibility.p3PrePurchase,
      packsEligibility: card.maccEligibility.capacityPacks,
    },
  });

  /* ---- Rule 5: licence ------------------------------------------- */
  const licenceFired =
    licenceBreakEven.worthwhile &&
    licenceBreakEven.creditsPerUnlicensedInternalUserPerMonth >
      licenceBreakEven.breakEvenCreditsAtPayg;
  if (licenceFired) penalise('licence-shift', 0.85);
  rules.push({
    id: 'licence',
    name: 'Licence test',
    fired: licenceFired,
    reason: licenceFired
      ? `Unlicensed internal users average ${Math.round(licenceBreakEven.creditsPerUnlicensedInternalUserPerMonth).toLocaleString('en-US')} credits a month, above the ${Math.round(licenceBreakEven.breakEvenCreditsAtPayg).toLocaleString('en-US')}-credit seat break-even.`
      : `Unlicensed internal users average ${Math.round(licenceBreakEven.creditsPerUnlicensedInternalUserPerMonth).toLocaleString('en-US')} credits a month, below the ${Math.round(licenceBreakEven.breakEvenCreditsAtPayg).toLocaleString('en-US')}-credit seat break-even.`,
    effect: licenceFired
      ? 'Shift licensing first, then size the remaining funding on residual external traffic only.'
      : 'Buy licences for their productivity value, not to offset agent credits.',
    evidence: {
      creditsPerUnlicensedUser: licenceBreakEven.creditsPerUnlicensedInternalUserPerMonth,
      breakEvenCredits: licenceBreakEven.breakEvenCreditsAtPayg,
      annualNetBenefitUsd: licenceBreakEven.annualNetBenefitUsd,
      externalCreditsNeverOffsettable: licenceBreakEven.externalCreditsNeverOffsettable,
    },
  });

  /* ---- Rule 6: governance ---------------------------------------- */
  const needsAttribution = normalised.answers.growth.costAttributionPerBu;
  const governanceActions: string[] = [];
  if (needsAttribution) {
    governanceActions.push(
      'Create a separate billing policy per business unit so credit consumption lands against the right cost centre.',
    );
    governanceActions.push(
      'Scope credit policies per environment so a runaway agent in development cannot consume production capacity.',
    );
  }
  if (PREPAID_OPTIONS.includes(primaryCandidateId(options, disqualified))) {
    governanceActions.push(
      'Set consumption alerts at 50%, 80% and 100% of the prepaid plan so overspend is discovered in week two, not at invoice time.',
    );
  }
  if (normalised.answers.growth.confidence === 'low') {
    governanceActions.push(
      'Nominate an owner for credit consumption and instrument usage telemetry before you buy anything — an unowned meter on an untrusted forecast is how surprise invoices happen.',
    );
  }
  rules.push({
    id: 'governance',
    name: 'Governance test',
    fired: needsAttribution,
    reason: needsAttribution
      ? 'You need to attribute cost to individual business units.'
      : 'No per-business-unit cost attribution was requested.',
    effect:
      governanceActions.length > 0
        ? `${governanceActions.length} governance action${governanceActions.length === 1 ? '' : 's'} added to the plan.`
        : 'No additional governance actions required.',
    evidence: {
      costAttributionPerBu: needsAttribution,
      confidence: normalised.answers.growth.confidence,
    },
  });

  /* ---- Rule 7: safety net ---------------------------------------- */
  const hardStopAcceptable = normalised.answers.growth.budgetTolerance === 'never';
  if (!hardStopAcceptable) {
    disqualified.set(
      'packs-only',
      'A hard capacity stop is not acceptable to you, so an option with no overage path cannot be recommended.',
    );
  }
  const safetyNet = hardStopAcceptable
    ? null
    : 'Pair any prepaid capacity with a pay-as-you-go overage policy so agents degrade gracefully instead of failing when you exceed the plan.';
  rules.push({
    id: 'safety-net',
    name: 'Safety net',
    fired: !hardStopAcceptable,
    reason: hardStopAcceptable
      ? 'You told us a hard stop is acceptable when capacity is exhausted.'
      : 'You told us an overage is preferable to agents stopping.',
    effect: hardStopAcceptable
      ? 'Hard-stop options remain on the table.'
      : 'Every prepaid recommendation is paired with a pay-as-you-go overage policy, and the hard-stop option is excluded.',
    evidence: { budgetTolerance: normalised.answers.growth.budgetTolerance },
  });

  /* ---- "Do nothing" never wins while there is real demand -------- */
  if (annualDemand > 0) {
    disqualified.set(
      'do-nothing',
      'You have modelled real demand, so declining to fund it is a baseline for comparison rather than a plan.',
    );
  }

  /* ---- Scoring ---------------------------------------------------- */
  const ranked: RankedOption[] = options
    .map((option) => {
      const blocked = disqualified.has(option.id) || !option.eligible;
      const score = blocked
        ? Number.POSITIVE_INFINITY
        : option.twelveMonthTotalUsd * (multipliers.get(option.id) ?? 1);
      return { option, score, blocked };
    })
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.option.twelveMonthTotalUsd - b.option.twelveMonthTotalUsd;
    })
    .map(({ option, score, blocked }) => ({
      optionId: option.id,
      label: option.label,
      twelveMonthTotalUsd: option.twelveMonthTotalUsd,
      deltaVsPrimaryUsd: 0,
      tradeOff: blocked
        ? (disqualified.get(option.id) ?? option.ineligibleReasons[0] ?? 'Not applicable.')
        : `${option.bestWhen} ${option.avoidWhen}`,
      score,
    }));

  const primary = ranked[0] ?? {
    optionId: 'payg' as FundingOptionId,
    label: 'Pay-as-you-go only',
    twelveMonthTotalUsd: 0,
    deltaVsPrimaryUsd: 0,
    tradeOff: 'No option could be evaluated.',
    score: 0,
  };

  for (const entry of ranked) {
    entry.deltaVsPrimaryUsd = entry.twelveMonthTotalUsd - primary.twelveMonthTotalUsd;
  }

  const alternatives = ranked.slice(1, 3);

  const paygTotal = byId.get('payg')?.twelveMonthTotalUsd ?? 0;
  const annualSavingVsNaivePaygUsd = paygTotal - primary.twelveMonthTotalUsd;
  const primaryOption = byId.get(primary.optionId);

  const headline = buildHeadline(primary, primaryOption, annualSavingVsNaivePaygUsd, safetyNet);

  audit.record(
    'recommendation:primary',
    'score = twelveMonthTotalUsd × Π(ruleMultipliers); disqualified options score Infinity; lowest score wins.',
    {
      primary: primary.optionId,
      primaryTotalUsd: primary.twelveMonthTotalUsd,
      naivePaygTotalUsd: paygTotal,
      rulesFired: rules.filter((r) => r.fired).length,
    },
    annualSavingVsNaivePaygUsd,
    'USD saved over 12 months vs naive pay-as-you-go',
    'modelAssumptions',
  );

  return {
    primary,
    alternatives,
    ranked,
    headline,
    confidenceChip:
      normalised.confidence === 'high' ? 'High' : normalised.confidence === 'medium' ? 'Medium' : 'Low',
    annualSavingVsNaivePaygUsd,
    rules,
    governanceActions,
    safetyNet,
  };
}

/** Cheapest not-yet-disqualified option, used before final scoring to shape governance advice. */
function primaryCandidateId(
  options: FundingOption[],
  disqualified: Map<FundingOptionId, string>,
): FundingOptionId {
  const candidates = options
    .filter((o) => o.eligible && !disqualified.has(o.id) && o.id !== 'do-nothing')
    .sort((a, b) => a.twelveMonthTotalUsd - b.twelveMonthTotalUsd);
  return candidates[0]?.id ?? 'payg';
}

function buildHeadline(
  primary: RankedOption,
  option: FundingOption | undefined,
  saving: number,
  safetyNet: string | null,
): string {
  const total = usd(primary.twelveMonthTotalUsd);
  const base = `Fund this with ${primary.label.charAt(0).toLowerCase()}${primary.label.slice(1)} — ${total} over twelve months`;
  const savingClause =
    saving > 0
      ? `, ${usd(saving)} less than paying full retail on the meter`
      : saving < 0
        ? `, ${usd(Math.abs(saving))} more than the metered baseline but ${describeWhyMore(option)}`
        : '';
  const netClause = safetyNet ? ', with a pay-as-you-go overage policy behind it' : '';
  return `${base}${savingClause}${netClause}.`;
}

function describeWhyMore(option: FundingOption | undefined): string {
  if (!option) return 'with a materially better risk profile';
  if (option.id === 'licence-shift') return 'it buys productivity value the meter never delivers';
  if (option.id === 'byom-foundry') return 'it removes your dependence on credit pricing entirely';
  if (option.shortfallRiskPct === 0) return 'nothing in your estate is left exposed to a hard stop';
  return 'the risk profile is materially better';
}

/** Effective blended rate helper used by the results dashboard. */
export function effectiveRateFor(option: FundingOption): number {
  return safeDiv(option.twelveMonthTotalUsd, option.creditsServed);
}
