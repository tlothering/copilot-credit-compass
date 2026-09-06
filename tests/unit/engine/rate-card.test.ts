import { describe, expect, it } from 'vitest';
import type { ConsumptionRateId, RateCard } from '@/lib/engine/types';
import {
  consumptionRate,
  creditsPerUnit,
  getRateCard,
  m365SeatMonthlyUsd,
  p3TierFor,
  p3Tiers,
  packCredits,
  packMonthlyUsd,
  packUsdPerCredit,
  paygCreditUsd,
  unverifiedRows,
} from '@/lib/engine/rate-card';

const card = getRateCard();

describe('rate card integrity (constraint C6)', () => {
  it('carries a version, effective date and currency', () => {
    expect(card.version).toMatch(/^v\d/);
    expect(card.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(card.currency).toBe('USD');
  });

  it('gives every consumption row a label, unit, sourceUrl and verified flag', () => {
    const ids = Object.keys(card.consumption);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const [id, rate] of Object.entries(card.consumption)) {
      expect(rate.label, id).toBeTruthy();
      expect(rate.unit, id).toBeTruthy();
      expect(typeof rate.credits, id).toBe('number');
      expect(rate.credits, id).toBeGreaterThanOrEqual(0);
      expect(rate.sourceUrl, id).toMatch(/^https:\/\//);
      expect(typeof rate.verified, id).toBe('boolean');
    }
  });

  it('prices the seeded rows exactly as SPEC §6.2 states', () => {
    const expected: Array<[ConsumptionRateId, number, string]> = [
      ['classic-answer', 1, 'answer'],
      ['generative-answer', 2, 'answer'],
      ['agent-action', 5, 'action'],
      ['tenant-graph-grounding', 10, 'message'],
      // "13 per 100 actions" → 0.13 per action.
      ['agent-flow-action', 0.13, 'action'],
      // "1 per 10 responses (0.1 per 1K tokens)" and friends.
      ['ai-tools-basic-response', 0.1, 'response'],
      ['ai-tools-standard-response', 1.5, 'response'],
      ['ai-tools-premium-response', 10, 'response'],
      ['ai-tools-basic-tokens', 0.1, '1K tokens'],
      ['ai-tools-standard-tokens', 1.5, '1K tokens'],
      ['ai-tools-premium-tokens', 10, '1K tokens'],
      ['content-processing-page', 8, 'page or image'],
      ['voice-classic-minute', 10, 'minute'],
      ['voice-genai-minute', 35, 'minute'],
      ['voice-premium-genai-minute', 75, 'minute'],
    ];
    for (const [id, credits, unit] of expected) {
      expect(creditsPerUnit(card, id), id).toBe(credits);
      expect(consumptionRate(card, id).unit, id).toBe(unit);
    }
  });

  it('marks the Microsoft-Learn-sourced rows verified and the derived rows unverified', () => {
    for (const id of ['classic-answer', 'generative-answer', 'voice-genai-minute'] as const) {
      expect(consumptionRate(card, id).verified, id).toBe(true);
    }
    for (const id of ['retrieval-api-query', 'cowork-task'] as const) {
      expect(consumptionRate(card, id).verified, id).toBe(false);
    }
  });

  describe('GitHub Copilot AI credits (billing model change of 2026-06-01)', () => {
    const gh = card.commercial.githubCopilot;

    it('prices an AI credit at one cent and carries it 1:1 onto the credit meter', () => {
      expect(gh.billingModel).toBe('ai-credits');
      expect(gh.billingModelEffectiveDate).toBe('2026-06-01');
      expect(gh.aiCreditUsd).toBe(0.01);
      expect(gh.overageCreditUsd).toBe(0.01);
      expect(creditsPerUnit(card, 'github-ai-credit')).toBe(1);
      expect(consumptionRate(card, 'github-ai-credit').unit).toBe('AI credit');
      expect(consumptionRate(card, 'github-ai-credit').verified).toBe(true);
      expect(consumptionRate(card, 'github-ai-credit').sourceUrl).toMatch(/docs\.github\.com/);
    });

    it('includes 1,900 Business and 3,900 Enterprise credits at unchanged seat prices', () => {
      expect(gh.plans.business.seatMonthlyUsd).toBe(19);
      expect(gh.plans.business.includedAiCreditsPerUserPerMonth).toBe(1_900);
      expect(gh.plans.enterprise.seatMonthlyUsd).toBe(39);
      expect(gh.plans.enterprise.includedAiCreditsPerUserPerMonth).toBe(3_900);
    });

    it('pools the allowance, never rolls it over, and resets on day one at midnight UTC', () => {
      expect(gh.poolScope).toBe('billing-entity');
      expect(gh.creditsRollOver).toBe(false);
      expect(gh.poolResetDayOfMonth).toBe(1);
      expect(gh.poolResetTimeUtc).toBe('00:00');
      expect(gh.poolNote).toBeTruthy();
    });

    it('never bills code completions or next edit suggestions', () => {
      expect(gh.codeCompletionsBilled).toBe(false);
      expect(gh.nextEditSuggestionsBilled).toBe(false);
      expect(gh.unlimitedOnPaidPlans.length).toBeGreaterThan(0);
      for (const f of gh.billedFeatures) {
        expect(f.toLowerCase()).not.toContain('completion');
      }
    });

    it('enables overage by default with no silent downgrade to a cheaper model', () => {
      expect(gh.overageEnabledByDefault).toBe(true);
      expect(gh.automaticFallbackToCheaperModel).toBe(false);
      expect(gh.userLevelBudgetsCanHaltIndividual).toBe(true);
    });

    it('retains the expired launch promotion so a dropped allowance can be explained', () => {
      expect(gh.promotionalAllowance.expired).toBe(true);
      expect(gh.promotionalAllowance.business).toBe(3_000);
      expect(gh.promotionalAllowance.enterprise).toBe(7_000);
      expect(gh.promotionalAllowance.startDate).toBe('2026-06-01');
      expect(gh.promotionalAllowance.endDate).toBe('2026-09-01');
      expect(gh.promotionalAllowance.business).toBeGreaterThan(
        gh.plans.business.includedAiCreditsPerUserPerMonth,
      );
    });

    it('flags the interaction archetypes as unverified planning placeholders', () => {
      expect(gh.interactionArchetypes.length).toBeGreaterThanOrEqual(4);
      for (const a of gh.interactionArchetypes) {
        expect(a.verified, a.id).toBe(false);
        expect(a.creditsLow, a.id).toBeLessThanOrEqual(a.creditsTypical);
        expect(a.creditsTypical, a.id).toBeLessThanOrEqual(a.creditsHigh);
      }
      expect(gh.interactionArchetypeNote).toBeTruthy();
    });

    it('places a standard user inside the Business allowance and a heavy user outside it', () => {
      const { githubAiCreditsPerStandardUserPerMonth: std, githubAiCreditsPerHeavyUserPerMonth: hvy } =
        card.modelAssumptions;
      expect(std).toBeLessThan(gh.plans.business.includedAiCreditsPerUserPerMonth);
      expect(hvy).toBeGreaterThan(gh.plans.business.includedAiCreditsPerUserPerMonth);
      expect(hvy).toBeLessThan(gh.plans.enterprise.includedAiCreditsPerUserPerMonth);
      expect(card.modelAssumptions.githubAiCreditAssumptionNote).toBeTruthy();
    });
  });

  it('throws a helpful error for an unknown rate id', () => {
    expect(() => consumptionRate(card, 'not-a-rate' as ConsumptionRateId)).toThrow(
      /has no consumption rate "not-a-rate"/,
    );
  });

  it('exposes the commercial anchors from SPEC §6.2', () => {
    expect(paygCreditUsd(card)).toBe(0.01);
    expect(packCredits(card)).toBe(25_000);
    expect(packMonthlyUsd(card)).toBe(200);
    expect(packUsdPerCredit(card)).toBe(0.008);
    expect(m365SeatMonthlyUsd(card)).toBe(30);
  });

  it('keeps the pack effective rate arithmetically consistent', () => {
    expect(packMonthlyUsd(card) / packCredits(card)).toBeCloseTo(packUsdPerCredit(card), 12);
  });

  it('is the single source of truth — no price literals in engine TypeScript', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../../../lib/engine/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      if (file === 'rate-card.ts') continue;
      const source = await readFile(new URL(file, dir), 'utf8');
      const stripped = source
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
        .join('\n');
      // The seeded USD anchors must never appear as literals outside the rate-card module.
      expect(stripped, `${file} hard-codes 0.008`).not.toMatch(/[^.\d]0\.008\b/);
      expect(stripped, `${file} hard-codes 25000`).not.toMatch(/\b25_?000\b/);
    }
  });
});

describe('P3 tier ladder', () => {
  it('is sorted ascending and strictly increasing in discount', () => {
    const tiers = p3Tiers(card);
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < tiers.length; i += 1) {
      expect(tiers[i]!.commitUnits).toBeGreaterThan(tiers[i - 1]!.commitUnits);
      expect(tiers[i]!.discountPct).toBeGreaterThan(tiers[i - 1]!.discountPct);
    }
  });

  it('contains the SPEC-anchored 15,000 CU / 6% rung as verified', () => {
    const anchor = p3Tiers(card).find((t) => t.commitUnits === 15_000);
    expect(anchor).toBeDefined();
    expect(anchor!.discountPct).toBe(6);
    expect(anchor!.verified).toBe(true);
  });

  it('selects the largest tier at or below the commit', () => {
    const tiers = p3Tiers(card);
    const smallest = tiers[0]!;
    const largest = tiers[tiers.length - 1]!;
    expect(p3TierFor(card, smallest.commitUnits - 1)).toBeNull();
    expect(p3TierFor(card, smallest.commitUnits)?.commitUnits).toBe(smallest.commitUnits);
    expect(p3TierFor(card, largest.commitUnits * 10)?.commitUnits).toBe(largest.commitUnits);
    expect(p3TierFor(card, 15_000)?.discountPct).toBe(6);
    expect(p3TierFor(card, 14_999)?.commitUnits).toBe(5_000);
  });

  it('returns null for a zero or negative commit', () => {
    expect(p3TierFor(card, 0)).toBeNull();
    expect(p3TierFor(card, -1)).toBeNull();
  });
});

describe('unverifiedRows', () => {
  it('lists every row not verifiable against public Microsoft documentation', () => {
    const rows = unverifiedRows(card);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.ref).toBeTruthy();
    const refs = rows.map((r) => r.ref);
    // cowork-task is a derived rate and must be flagged.
    expect(refs).toContain('consumption.cowork-task');
    // github-ai-credit is now documented by GitHub, so it must NOT be flagged.
    expect(refs).not.toContain('consumption.github-ai-credit');
  });

  it('omits rows that are verified', () => {
    const refs = unverifiedRows(card).map((r) => r.ref);
    expect(refs).not.toContain('consumption.classic-answer');
    expect(refs).not.toContain('consumption.generative-answer');
  });

  it('includes commercial, P3 and MACC rows when those are unverified', () => {
    const synthetic: RateCard = {
      ...card,
      commercial: { ...card.commercial, foundry: { ...card.commercial.foundry, verified: false } },
      p3PrePurchasePlan: {
        ...card.p3PrePurchasePlan,
        tiers: [{ commitUnits: 100, discountPct: 1, verified: false }],
      },
      maccEligibility: { ...card.maccEligibility, verified: false },
    };
    const refs = unverifiedRows(synthetic).map((r) => r.ref);
    expect(refs).toContain('commercial.foundry');
    expect(refs).toContain('p3PrePurchasePlan.tiers.100');
    expect(refs).toContain('maccEligibility');
  });

  it('omits commercial, P3 and MACC rows when those are verified', () => {
    const synthetic: RateCard = {
      ...card,
      commercial: { ...card.commercial, foundry: { ...card.commercial.foundry, verified: true } },
      p3PrePurchasePlan: {
        ...card.p3PrePurchasePlan,
        tiers: [{ commitUnits: 100, discountPct: 1, verified: true }],
      },
      maccEligibility: { ...card.maccEligibility, verified: true },
    };
    const refs = unverifiedRows(synthetic).map((r) => r.ref);
    expect(refs).not.toContain('commercial.foundry');
    expect(refs).not.toContain('p3PrePurchasePlan.tiers.100');
    expect(refs).not.toContain('maccEligibility');
  });
});
