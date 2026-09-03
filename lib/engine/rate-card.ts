import rateCardJson from '@/data/rate-card.v1.json';
import type { ConsumptionRate, ConsumptionRateId, P3Tier, RateCard } from './types';

/**
 * Constraint C6 — the rate card is data, not code. This module is the ONLY place
 * that reads the JSON, and nothing anywhere else in the codebase may hard-code a price.
 */
export const rateCard = rateCardJson as unknown as RateCard;

export function getRateCard(): RateCard {
  return rateCard;
}

export function consumptionRate(card: RateCard, id: ConsumptionRateId): ConsumptionRate {
  const rate = card.consumption[id];
  if (!rate) throw new Error(`Rate card ${card.version} has no consumption rate "${id}"`);
  return rate;
}

export function creditsPerUnit(card: RateCard, id: ConsumptionRateId): number {
  return consumptionRate(card, id).credits;
}

export function paygCreditUsd(card: RateCard): number {
  return card.commercial.paygCreditUsd.value;
}

export function packCredits(card: RateCard): number {
  return card.commercial.capacityPack.credits;
}

export function packMonthlyUsd(card: RateCard): number {
  return card.commercial.capacityPack.monthlyUsd;
}

export function packUsdPerCredit(card: RateCard): number {
  return card.commercial.capacityPack.effectiveUsdPerCredit;
}

export function m365SeatMonthlyUsd(card: RateCard): number {
  return card.commercial.m365CopilotSeatMonthlyUsd.value;
}

/** P3 tiers sorted ascending by commit size. */
export function p3Tiers(card: RateCard): P3Tier[] {
  return [...card.p3PrePurchasePlan.tiers].sort((a, b) => a.commitUnits - b.commitUnits);
}

/** The largest tier whose commit threshold is met by `commitUnits`, or null. */
export function p3TierFor(card: RateCard, commitUnits: number): P3Tier | null {
  const eligible = p3Tiers(card).filter((t) => commitUnits >= t.commitUnits);
  return eligible.length === 0 ? null : (eligible[eligible.length - 1] ?? null);
}

/** Every rate-card row that is not Microsoft-Learn verified, for transparency surfaces. */
export function unverifiedRows(card: RateCard): { ref: string; label: string; note?: string }[] {
  const rows: { ref: string; label: string; note?: string }[] = [];
  for (const [id, rate] of Object.entries(card.consumption)) {
    if (!rate.verified) rows.push({ ref: `consumption.${id}`, label: rate.label, note: rate.note });
  }
  if (!card.commercial.foundry.verified) {
    rows.push({
      ref: 'commercial.foundry',
      label: card.commercial.foundry.label,
      note: card.commercial.foundry.note,
    });
  }
  for (const tier of card.p3PrePurchasePlan.tiers) {
    if (!tier.verified) {
      rows.push({
        ref: `p3PrePurchasePlan.tiers.${tier.commitUnits}`,
        label: `P3 tier ${tier.commitUnits.toLocaleString('en-US')} CU (${tier.discountPct}%)`,
      });
    }
  }
  if (!card.maccEligibility.verified) {
    rows.push({
      ref: 'maccEligibility',
      label: card.maccEligibility.label,
      note: card.maccEligibility.note,
    });
  }
  return rows;
}
