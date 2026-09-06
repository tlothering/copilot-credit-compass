import type {
  CreditLine,
  CreditModel,
  CreditModelOptions,
  CurrencyTotals,
  RateCard,
  VolumeModel,
} from './types';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { consumptionRate, creditCurrency } from './rate-card';
import type { AuditTrail } from './util';

/** The pool the Microsoft funding vehicles size against. */
const MICROSOFT = 'microsoft-copilot-credit';

/**
 * SPEC §6.3 — the licence offset.
 *
 *   billableCredits = Σ volume(w) × rate(w) × (1 − m365CopilotLicensedShareOfUsers(w))
 *
 * Core agent activity is not charged when the *consuming user* holds a Microsoft 365
 * Copilot licence. External/customer traffic can never be offset, so its internal share
 * is zero and it is always metered.
 *
 * Credits are partitioned by meter. The scalar totals returned here cover Microsoft
 * Copilot Credits only; anything billed on another meter (today, GitHub AI credits) is
 * kept out of them so that no Microsoft funding vehicle is ever sized against money it
 * cannot pay. The full picture is in `byCurrency`.
 */
export function buildCreditModel(
  volume: VolumeModel,
  card: RateCard,
  audit: AuditTrail,
  options: CreditModelOptions = {},
): CreditModel {
  const lines: CreditLine[] = [];
  let grossCredits = 0;
  let offsetCredits = 0;
  let billableCredits = 0;
  let internalBillableCredits = 0;
  let externalBillableCredits = 0;
  let offsettableRemainingCredits = 0;

  const byWorkloadMap = new Map<WorkloadId, { grossCredits: number; billableCredits: number }>();
  const byCurrencyMap = new Map<
    string,
    { grossCredits: number; offsetCredits: number; billableCredits: number }
  >();

  for (const line of volume.lines) {
    const rate = consumptionRate(card, line.rateId);
    const zeroRatedByByom = options.byomZeroRateGenerative === true && line.rateId === 'generative-answer';
    const perUnit = zeroRatedByByom ? 0 : rate.credits;
    const gross = line.quantity * perUnit;

    const offsetEligible = rate.offsetByM365CopilotLicence;
    const licensedShare = options.assumeAllInternalLicensed === true ? 1 : line.licensedShareOfInternal;
    const offsetShare = offsetEligible ? line.internalShare * licensedShare : 0;
    const offset = gross * offsetShare;
    const billable = gross - offset;

    const currencyBucket = byCurrencyMap.get(rate.currency) ?? {
      grossCredits: 0,
      offsetCredits: 0,
      billableCredits: 0,
    };
    currencyBucket.grossCredits += gross;
    currencyBucket.offsetCredits += offset;
    currencyBucket.billableCredits += billable;
    byCurrencyMap.set(rate.currency, currencyBucket);

    // Only the Microsoft pool feeds the scalar totals the funding engine consumes.
    if (rate.currency === MICROSOFT) {
      const internalGross = gross * line.internalShare;
      const externalGross = gross * (1 - line.internalShare);
      const internalBillable = internalGross - offset;
      const remainingOffsettable = offsetEligible ? internalGross * (1 - licensedShare) : 0;

      grossCredits += gross;
      offsetCredits += offset;
      billableCredits += billable;
      internalBillableCredits += internalBillable;
      externalBillableCredits += externalGross;
      offsettableRemainingCredits += remainingOffsettable;

      const bucket = byWorkloadMap.get(line.workloadId) ?? { grossCredits: 0, billableCredits: 0 };
      bucket.grossCredits += gross;
      bucket.billableCredits += billable;
      byWorkloadMap.set(line.workloadId, bucket);
    }

    lines.push({
      ...line,
      creditsPerUnit: perUnit,
      currency: rate.currency,
      grossCredits: gross,
      offsetEligible,
      offsetShare,
      offsetCredits: offset,
      billableCredits: billable,
    });

    audit.record(
      `credits:${line.lineId}`,
      offsetEligible
        ? 'billable = quantity × creditsPerUnit × (1 − internalShare × m365CopilotLicensedShare)'
        : 'billable = quantity × creditsPerUnit (this rate is never offset by a Microsoft 365 Copilot licence)',
      {
        quantity: line.quantity,
        creditsPerUnit: perUnit,
        displayRate: rate.displayRate,
        currency: rate.currency,
        meter: creditCurrency(card, rate.currency).meter,
        internalShare: line.internalShare,
        m365CopilotLicensedShare: licensedShare,
        offsetEligible,
        zeroRatedByByom,
      },
      billable,
      `${creditCurrency(card, rate.currency).label}s/month`,
      `consumption.${line.rateId}`,
    );
  }

  const byCurrency: CurrencyTotals[] = [...byCurrencyMap.entries()].map(([id, v]) => {
    const meta = creditCurrency(card, id as CurrencyTotals['currency']);
    return {
      currency: id as CurrencyTotals['currency'],
      label: meta.label,
      meter: meta.meter,
      unitUsd: meta.unitUsd,
      grossCredits: v.grossCredits,
      offsetCredits: v.offsetCredits,
      billableCredits: v.billableCredits,
      billableCostUsd: v.billableCredits * meta.unitUsd,
      fundableBy: meta.fundableBy,
    };
  });

  const other = byCurrency.filter((c) => c.currency !== MICROSOFT);
  const otherMeterBillableCredits = other.reduce((a, c) => a + c.billableCredits, 0);
  const otherMeterCostUsd = other.reduce((a, c) => a + c.billableCostUsd, 0);

  audit.record(
    'credits:total',
    'billableCredits = grossCredits − licenceOffsetCredits, for Microsoft Copilot Credits only; credits on another meter are totalled separately because no Microsoft funding vehicle can pay for them',
    {
      grossCredits,
      licenceOffsetCredits: offsetCredits,
      otherMeterBillableCredits,
      otherMeters: other.map((c) => c.meter).join(', ') || 'none',
    },
    billableCredits,
    'Microsoft Copilot Credits/month',
    'consumption',
  );

  if (other.length > 0) {
    for (const c of other) {
      audit.record(
        `credits:other-meter:${c.currency}`,
        'cost = billableCredits × currencyUnitPrice, billed on its own meter and not fundable by any Microsoft vehicle',
        {
          currency: c.currency,
          meter: c.meter,
          billableCredits: c.billableCredits,
          unitUsd: c.unitUsd,
          fundableByMicrosoftVehicles: c.fundableBy.length > 0,
        },
        c.billableCostUsd,
        'USD/month',
        `creditCurrencies.${c.currency}`,
      );
    }
  }

  return {
    lines,
    grossCredits,
    offsetCredits,
    billableCredits,
    internalBillableCredits,
    externalBillableCredits,
    offsettableRemainingCredits,
    byWorkload: [...byWorkloadMap.entries()].map(([workloadId, v]) => ({
      workloadId,
      grossCredits: v.grossCredits,
      billableCredits: v.billableCredits,
    })),
    byCurrency,
    otherMeterBillableCredits,
    otherMeterCostUsd,
  };
}
