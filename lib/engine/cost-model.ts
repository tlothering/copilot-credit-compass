import type {
  CostModel,
  CreditModel,
  NormalisedAnswers,
  PlatformCostLine,
  RateCard,
} from './types';
import { m365SeatMonthlyUsd, paygCreditUsd } from './rate-card';
import type { AuditTrail } from './util';
import { safeDiv } from './util';

/**
 * Turns credits into dollars, and adds the platform costs that are NOT paid in credits:
 * Microsoft 365 Copilot seats, GitHub Copilot seats, Security Copilot SCUs and Foundry
 * tokens. Those costs are common to every funding option, so isolating them here keeps
 * the funding comparison honest.
 */
export function buildCostModel(
  credits: CreditModel,
  normalised: NormalisedAnswers,
  card: RateCard,
  audit: AuditTrail,
): CostModel {
  const usage = normalised.answers.usage;
  const assumptions = card.modelAssumptions;
  const payg = paygCreditUsd(card);
  const meteredCreditCostUsd = credits.billableCredits * payg;

  audit.record(
    'cost:metered-credits',
    'meteredCreditCost = billableMicrosoftCopilotCredits × payAsYouGoCreditPrice',
    { billableCredits: credits.billableCredits, payAsYouGoCreditPrice: payg },
    meteredCreditCostUsd,
    'USD/month',
    'commercial.paygCreditUsd',
  );

  const platformLines: PlatformCostLine[] = [];

  /* ---------------- Credits billed on another meter ---------------- */
  // GitHub AI credit overage is real money, but no Microsoft funding vehicle can pay
  // for it. Treating it as a platform cost — common to every funding option, never
  // absorbed into a capacity pack, pre-purchase tier, MACC or Azure prepayment — is
  // what keeps the funding comparison honest.
  for (const line of credits.byCurrency) {
    if (line.currency === 'microsoft-copilot-credit' || line.billableCredits <= 0) continue;
    platformLines.push({
      id: `other-meter-${line.currency}`,
      label: `${line.label} overage (${line.meter} meter)`,
      monthlyUsd: line.billableCostUsd,
      annualUsd: line.billableCostUsd * 12,
      rateCardRef: `creditCurrencies.${line.currency}`,
      note: `${Math.round(line.billableCredits).toLocaleString('en-GB')} credits a month at $${line.unitUsd} each, billed by ${line.meter}. No Microsoft capacity pack, pre-purchase tier, MACC burn-down or Azure prepayment can fund this.`,
    });
    audit.record(
      `cost:other-meter:${line.currency}`,
      'cost = billableCredits × currencyUnitPrice, on its own meter',
      {
        currency: line.currency,
        meter: line.meter,
        billableCredits: line.billableCredits,
        unitUsd: line.unitUsd,
        fundableByMicrosoftVehicles: line.fundableBy.length > 0,
      },
      line.billableCostUsd,
      'USD/month',
      `creditCurrencies.${line.currency}`,
    );
  }

  /* ---------------- Microsoft 365 Copilot seats ---------------- */
  const m365 = usage['m365-copilot'];
  const seatsHeld = m365?.seats12m ?? 0;
  if (m365) {
    const seatPrice = m365SeatMonthlyUsd(card);
    const monthlyUsd = seatsHeld * seatPrice;
    platformLines.push({
      id: 'm365-copilot-seats',
      label: 'Microsoft 365 Copilot seats',
      monthlyUsd,
      annualUsd: monthlyUsd * 12,
      rateCardRef: 'commercial.m365CopilotSeatMonthlyUsd',
      note: `${seatsHeld.toLocaleString('en-US')} seats at month 12, ${m365.rampCurve} ramp`,
    });
    audit.record(
      'cost:m365-copilot-seats',
      'seatCost = seatsAtMonth12 × seatMonthlyPrice',
      { seatsAtMonth12: seatsHeld, seatMonthlyPrice: seatPrice, rampCurve: m365.rampCurve },
      monthlyUsd,
      'USD/month',
      'commercial.m365CopilotSeatMonthlyUsd',
    );
  }

  /* ---------------- GitHub Copilot seats ---------------- */
  const github = usage['github-copilot'];
  if (github) {
    const plan = card.commercial.githubCopilot.plans[github.plan];
    const monthlyUsd = github.seats * plan.seatMonthlyUsd;
    platformLines.push({
      id: 'github-copilot-seats',
      label: `GitHub Copilot ${github.plan} seats`,
      monthlyUsd,
      annualUsd: monthlyUsd * 12,
      rateCardRef: `commercial.githubCopilot.plans.${github.plan}`,
      note: `${plan.includedAiCreditsPerUserPerMonth.toLocaleString('en-GB')} AI credits included per user per month, pooled across the billing entity. Code completions and next edit suggestions are unlimited and never billed.`,
    });
    audit.record(
      'cost:github-copilot-seats',
      'seatCost = seats × seatMonthlyPrice',
      { seats: github.seats, seatMonthlyPrice: plan.seatMonthlyUsd, plan: github.plan },
      monthlyUsd,
      'USD/month',
      `commercial.githubCopilot.plans.${github.plan}`,
    );
  }

  /* ---------------- Security Copilot (SCU, not credits) ---------------- */
  const security = usage['security-copilot'];
  if (security) {
    const sc = card.commercial.securityCopilot;
    const daysPerMonth =
      security.coverage === '24x7'
        ? assumptions.hoursPerMonth / 24
        : assumptions.businessHoursDaysPerMonth;
    const hoursCovered =
      security.coverage === '24x7'
        ? assumptions.hoursPerMonth
        : assumptions.businessHoursDaysPerMonth * assumptions.businessHoursPerDay;

    const scuMinutesPerMonth =
      security.investigationsPerDay * daysPerMonth * security.scuMinutesPerInvestigation;
    const requiredScu = Math.max(
      sc.minimumScu,
      Math.ceil(safeDiv(scuMinutesPerMonth, hoursCovered * 60)),
    );
    const provisionedUsd = requiredScu * hoursCovered * sc.provisionedScuHourUsd;

    // Bursts above the provisioned floor fall back to the overage rate. We size the burst
    // with the user's own confidence-driven aggressive multiplier rather than inventing one.
    const aggressive = assumptions.confidenceMultipliers[normalised.confidence].aggressive;
    const burstScuMinutes = Math.max(
      0,
      scuMinutesPerMonth * aggressive - requiredScu * hoursCovered * 60,
    );
    const overageUsd = (burstScuMinutes / 60) * sc.overageScuHourUsd;
    const monthlyUsd = provisionedUsd + overageUsd;

    platformLines.push({
      id: 'security-copilot-scu',
      label: 'Security Copilot provisioned SCUs',
      monthlyUsd,
      annualUsd: monthlyUsd * 12,
      rateCardRef: 'commercial.securityCopilot',
      note: `${requiredScu} SCU provisioned across ${Math.round(hoursCovered)} covered hours (${security.coverage}, ${security.deployment})`,
    });
    audit.record(
      'cost:security-copilot',
      'requiredScu = max(minimumScu, ceil(scuMinutesPerMonth ÷ (coveredHours × 60))); cost = requiredScu × coveredHours × provisionedRate + burstMinutes ÷ 60 × overageRate',
      {
        analysts: security.analysts,
        investigationsPerDay: security.investigationsPerDay,
        scuMinutesPerInvestigation: security.scuMinutesPerInvestigation,
        coverage: security.coverage,
        deployment: security.deployment,
        scuMinutesPerMonth,
        coveredHours: hoursCovered,
        requiredScu,
        provisionedRate: sc.provisionedScuHourUsd,
        overageRate: sc.overageScuHourUsd,
        burstMultiplier: aggressive,
      },
      monthlyUsd,
      'USD/month',
      'commercial.securityCopilot',
    );
  }

  /* ---------------- Foundry / BYOM tokens ---------------- */
  const foundry = usage['foundry-byom'];
  if (foundry) {
    const f = card.commercial.foundry;
    const monthlyUsd =
      (foundry.inputTokensPerMonth / 1_000_000) * f.inputPerMillionTokensUsd +
      (foundry.outputTokensPerMonth / 1_000_000) * f.outputPerMillionTokensUsd;
    platformLines.push({
      id: 'foundry-tokens',
      label: 'Microsoft Foundry model tokens (Azure meter)',
      monthlyUsd,
      annualUsd: monthlyUsd * 12,
      rateCardRef: 'commercial.foundry',
      note: 'Billed on the Azure AI meter, separate from Copilot Credits',
    });
    audit.record(
      'cost:foundry-tokens',
      'tokenCost = inputTokens ÷ 1e6 × inputPrice + outputTokens ÷ 1e6 × outputPrice',
      {
        inputTokensPerMonth: foundry.inputTokensPerMonth,
        outputTokensPerMonth: foundry.outputTokensPerMonth,
        inputPerMillionTokensUsd: f.inputPerMillionTokensUsd,
        outputPerMillionTokensUsd: f.outputPerMillionTokensUsd,
      },
      monthlyUsd,
      'USD/month',
      'commercial.foundry',
    );
  }

  const platformMonthlyUsd = platformLines.reduce((acc, l) => acc + l.monthlyUsd, 0);
  const totalMonthlyUsd = meteredCreditCostUsd + platformMonthlyUsd;

  return {
    billableCredits: credits.billableCredits,
    meteredCreditCostUsd,
    platformLines,
    platformMonthlyUsd,
    platformAnnualUsd: platformMonthlyUsd * 12,
    totalMonthlyUsd,
    effectiveUsdPerCredit: safeDiv(meteredCreditCostUsd, credits.billableCredits),
    m365CopilotSeatsHeld: seatsHeld,
  };
}
