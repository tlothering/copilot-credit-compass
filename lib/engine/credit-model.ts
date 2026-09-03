import type {
  CreditLine,
  CreditModel,
  CreditModelOptions,
  RateCard,
  VolumeModel,
} from './types';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { consumptionRate } from './rate-card';
import type { AuditTrail } from './util';

/**
 * SPEC §6.3 — the licence offset.
 *
 *   billableCredits = Σ volume(w) × rate(w) × (1 − m365CopilotLicensedShareOfUsers(w))
 *
 * Core agent activity is not charged when the *consuming user* holds a Microsoft 365
 * Copilot licence. External/customer traffic can never be offset, so its internal share
 * is zero and it is always metered.
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

    lines.push({
      ...line,
      creditsPerUnit: perUnit,
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
        internalShare: line.internalShare,
        m365CopilotLicensedShare: licensedShare,
        offsetEligible,
        zeroRatedByByom,
      },
      billable,
      'credits/month',
      `consumption.${line.rateId}`,
    );
  }

  audit.record(
    'credits:total',
    'billableCredits = grossCredits − licenceOffsetCredits',
    { grossCredits, licenceOffsetCredits: offsetCredits },
    billableCredits,
    'credits/month',
    'consumption',
  );

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
  };
}
