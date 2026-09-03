import type { CreditModel, LicenceBreakEven, NormalisedAnswers, RateCard } from './types';
import { m365SeatMonthlyUsd, packUsdPerCredit, paygCreditUsd } from './rate-card';
import type { AuditTrail } from './util';
import { normalCdf, roundUsd, safeDiv } from './util';

/**
 * SPEC §6.3 — the flagship calculation.
 *
 * A Microsoft 365 Copilot seat costs $30/month. Core agent activity is free for its
 * holder. So the seat pays for itself once that user generates more credits than the
 * seat price buys on the meter:
 *
 *   breakEvenCredits = seatMonthlyPrice ÷ creditPrice
 *                    = $30 ÷ $0.01 = 3,000 credits (pay-as-you-go)
 *                    = $30 ÷ $0.008 = 3,750 credits (against pack pricing)
 *
 * Per-user consumption is never uniform, so rather than comparing a single average to
 * the threshold we spread consumption across the unlicensed internal population with a
 * log-normal distribution (sigma from the rate card). That gives an honest "X% of users
 * cross the line" figure and the conditional credit volume those users actually carry.
 */
export function buildLicenceBreakEven(
  credits: CreditModel,
  normalised: NormalisedAnswers,
  card: RateCard,
  audit: AuditTrail,
): LicenceBreakEven {
  const seatMonthlyUsd = m365SeatMonthlyUsd(card);
  const payg = paygCreditUsd(card);
  const packRate = packUsdPerCredit(card);
  const sigma = card.modelAssumptions.usageDistributionSigma;

  const breakEvenCreditsAtPayg = safeDiv(seatMonthlyUsd, payg);
  const breakEvenCreditsAtPackRate = safeDiv(seatMonthlyUsd, packRate);

  const internalUsers = normalised.internalUsers;
  const licensedInternalUsers = Math.round(internalUsers * normalised.internalLicensedShare);
  const unlicensedInternalUsers = Math.max(0, internalUsers - licensedInternalUsers);

  const creditsPerUnlicensedInternalUserPerMonth = safeDiv(
    credits.offsettableRemainingCredits,
    unlicensedInternalUsers,
  );

  audit.record(
    'licence:break-even-threshold',
    'breakEvenCredits = m365CopilotSeatMonthlyPrice ÷ payAsYouGoCreditPrice',
    { m365CopilotSeatMonthlyPrice: seatMonthlyUsd, payAsYouGoCreditPrice: payg },
    breakEvenCreditsAtPayg,
    'credits/user/month',
    'commercial.m365CopilotSeatMonthlyUsd',
  );

  let shareAboveBreakEven = 0;
  let creditsCarriedByUsersAboveBreakEven = 0;

  if (creditsPerUnlicensedInternalUserPerMonth > 0 && unlicensedInternalUsers > 0) {
    // Log-normal parameterised so that E[X] equals the modelled mean per-user consumption.
    const mu = Math.log(creditsPerUnlicensedInternalUserPerMonth) - (sigma * sigma) / 2;
    const lnThreshold = Math.log(breakEvenCreditsAtPayg);
    shareAboveBreakEven = 1 - normalCdf((lnThreshold - mu) / sigma);
    // E[X · 1{X > B}] = E[X] · Φ((μ + σ² − ln B) ÷ σ)
    const conditionalShare = normalCdf((mu + sigma * sigma - lnThreshold) / sigma);
    creditsCarriedByUsersAboveBreakEven =
      unlicensedInternalUsers * creditsPerUnlicensedInternalUserPerMonth * conditionalShare;
  }

  const usersAboveBreakEven = Math.round(unlicensedInternalUsers * shareAboveBreakEven);
  const monthlyMeteredSpendRemovedUsd = creditsCarriedByUsersAboveBreakEven * payg;
  const annualMeteredSpendRemovedUsd = monthlyMeteredSpendRemovedUsd * 12;
  const annualSeatCostUsd = usersAboveBreakEven * seatMonthlyUsd * 12;
  const annualNetBenefitUsd = annualMeteredSpendRemovedUsd - annualSeatCostUsd;

  audit.record(
    'licence:offset-opportunity',
    'usersAboveBreakEven = unlicensedInternalUsers × P(X > breakEven); spendRemoved = E[X · 1{X > breakEven}] × unlicensedUsers × creditPrice, where X ~ LogNormal(mean = offsettableCredits ÷ unlicensedUsers, sigma)',
    {
      offsettableRemainingCredits: credits.offsettableRemainingCredits,
      unlicensedInternalUsers,
      creditsPerUnlicensedInternalUserPerMonth,
      breakEvenCredits: breakEvenCreditsAtPayg,
      sigma,
      shareAboveBreakEvenPct: shareAboveBreakEven * 100,
    },
    monthlyMeteredSpendRemovedUsd,
    'USD/month removed',
    'commercial.m365CopilotSeatMonthlyUsd',
  );

  const externalCreditsNeverOffsettable = credits.externalBillableCredits;
  const externalMonthlyCostUsd = externalCreditsNeverOffsettable * payg;

  audit.record(
    'licence:external-exposure',
    'externalCost = externalBillableCredits × payAsYouGoCreditPrice (never offsettable by a licence)',
    { externalBillableCredits: externalCreditsNeverOffsettable, payAsYouGoCreditPrice: payg },
    externalMonthlyCostUsd,
    'USD/month',
    'commercial.paygCreditUsd',
  );

  const worthwhile = annualNetBenefitUsd > 0 && usersAboveBreakEven > 0;

  const narrative = buildNarrative({
    breakEvenCreditsAtPayg,
    breakEvenCreditsAtPackRate,
    shareAboveBreakEvenPct: shareAboveBreakEven * 100,
    usersAboveBreakEven,
    monthlyMeteredSpendRemovedUsd,
    externalMonthlyCostUsd,
    worthwhile,
    unlicensedInternalUsers,
  });

  return {
    seatMonthlyUsd,
    breakEvenCreditsAtPayg,
    breakEvenCreditsAtPackRate,
    internalUsers,
    licensedInternalUsers,
    unlicensedInternalUsers,
    creditsPerUnlicensedInternalUserPerMonth,
    shareOfUsersAboveBreakEvenPct: shareAboveBreakEven * 100,
    usersAboveBreakEven,
    creditsRemovedByTargetedShift: creditsCarriedByUsersAboveBreakEven,
    monthlyMeteredSpendRemovedUsd,
    annualMeteredSpendRemovedUsd,
    annualSeatCostUsd,
    annualNetBenefitUsd,
    worthwhile,
    externalCreditsNeverOffsettable,
    externalMonthlyCostUsd,
    narrative,
  };
}

function buildNarrative(input: {
  breakEvenCreditsAtPayg: number;
  breakEvenCreditsAtPackRate: number;
  shareOfUsersAboveBreakEvenPct?: number;
  shareAboveBreakEvenPct: number;
  usersAboveBreakEven: number;
  monthlyMeteredSpendRemovedUsd: number;
  externalMonthlyCostUsd: number;
  worthwhile: boolean;
  unlicensedInternalUsers: number;
}): string {
  const money = (v: number) =>
    `$${roundUsd(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const credits = (v: number) => Math.round(v).toLocaleString('en-US');

  const base = `A Microsoft 365 Copilot seat pays for itself once a user generates more than ${credits(
    input.breakEvenCreditsAtPayg,
  )} credits a month on the pay-as-you-go meter, or ${credits(
    input.breakEvenCreditsAtPackRate,
  )} credits against prepaid pack pricing.`;

  if (input.unlicensedInternalUsers === 0) {
    return `${base} Every internal user in scope already holds a licence, so all of your remaining metered spend is external or non-offsettable traffic${
      input.externalMonthlyCostUsd > 0
        ? ` — ${money(input.externalMonthlyCostUsd)} a month that no licence can remove.`
        : '.'
    }`;
  }

  if (!input.worthwhile) {
    return `${base} At your projected volume only ${input.shareAboveBreakEvenPct.toFixed(
      1,
    )}% of your ${credits(
      input.unlicensedInternalUsers,
    )} unlicensed internal users cross that line, so buying seats purely to zero-rate agent traffic would cost more than it saves. Licence for the productivity value instead, and fund the agent traffic on the meter.`;
  }

  return `${base} ${input.shareAboveBreakEvenPct.toFixed(1)}% of your ${credits(
    input.unlicensedInternalUsers,
  )} unlicensed internal users cross that line — licensing those ${credits(
    input.usersAboveBreakEven,
  )} users removes ${money(input.monthlyMeteredSpendRemovedUsd)} a month of metered spend.${
    input.externalMonthlyCostUsd > 0
      ? ` External and customer-facing traffic can never be offset by a licence, so ${money(
          input.externalMonthlyCostUsd,
        )} a month stays metered whatever you do.`
      : ''
  }`;
}
