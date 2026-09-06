import { describe, expect, it } from 'vitest';
import { runEngine } from '@/lib/engine';
import { card, flatAnswers, near } from './fixtures';

/**
 * GitHub Copilot bills AI credits on GitHub's own meter; every other workload bills
 * Microsoft Copilot Credits on the Microsoft usage-based meter. The two happen to cost
 * $0.01 each, which makes them dangerously easy to add together — but no Microsoft
 * purchasing vehicle (capacity pack, prepayment, MACC) can fund a GitHub bill. These
 * tests pin the separation so a future refactor cannot quietly re-merge the pools.
 */

const GITHUB_ONLY = flatAnswers(['github-copilot'], {
  'github-copilot': { seats: 400, plan: 'business', heavyUserPct: 100, modelTier: 'premium' },
});
const MICROSOFT_ONLY = flatAnswers(['copilot-studio-agents', 'm365-copilot-chat']);
const MIXED = flatAnswers(['github-copilot', 'copilot-studio-agents'], {
  'github-copilot': { seats: 400, plan: 'business', heavyUserPct: 100, modelTier: 'premium' },
});

describe('rate card credit currencies', () => {
  it('declares a currency on every consumption rate', () => {
    for (const [id, rate] of Object.entries(card.consumption)) {
      expect(rate.currency, id).toBeTruthy();
      expect(card.creditCurrencies[rate.currency], `${id} -> ${rate.currency}`).toBeDefined();
    }
  });

  it('keeps each currency unit price equal to the commercial rate it is drawn from', () => {
    // The unit price is duplicated for ergonomics; this test is the anti-drift guard.
    expect(card.creditCurrencies['microsoft-copilot-credit'].unitUsd).toBe(
      card.commercial.paygCreditUsd.value,
    );
    expect(card.creditCurrencies['github-ai-credit'].unitUsd).toBe(
      card.commercial.githubCopilot.overageCreditUsd,
    );
  });

  it('lets no Microsoft purchasing vehicle claim it can fund GitHub AI credits', () => {
    expect(card.creditCurrencies['github-ai-credit'].fundableBy).toEqual([]);
    expect(card.creditCurrencies['microsoft-copilot-credit'].fundableBy.length).toBeGreaterThan(0);
    expect(card.creditCurrencies['microsoft-copilot-credit'].fundableBy).not.toContain('do-nothing');
  });

  it('routes exactly one rate to the GitHub meter', () => {
    const gh = Object.entries(card.consumption).filter(
      ([, r]) => r.currency === 'github-ai-credit',
    );
    expect(gh.map(([id]) => id)).toEqual(['github-ai-credit']);
  });
});

describe('credit model keeps the two meters apart', () => {
  it('never counts GitHub AI credits in the Microsoft billable pool', () => {
    const { credits } = runEngine(MIXED);
    // Every line is retained for display, but the scalar totals are Microsoft-only.
    const ms = credits.lines.filter((l) => l.currency === 'microsoft-copilot-credit');
    const gh = credits.lines.filter((l) => l.currency === 'github-ai-credit');
    expect(ms.length).toBeGreaterThan(0);
    expect(gh.length).toBeGreaterThan(0);
    expect(near(credits.billableCredits)).toBe(
      near(ms.reduce((a, l) => a + l.billableCredits, 0)),
    );
    expect(near(credits.grossCredits)).toBe(near(ms.reduce((a, l) => a + l.grossCredits, 0)));

    const bucket = credits.byCurrency.find((c) => c.currency === 'github-ai-credit');
    expect(bucket).toBeDefined();
    expect(near(bucket!.billableCredits)).toBe(
      near(gh.reduce((a, l) => a + l.billableCredits, 0)),
    );
    expect(credits.otherMeterBillableCredits).toBe(bucket!.billableCredits);
  });

  it('keeps the per-workload rollup on the Microsoft meter only', () => {
    const { credits } = runEngine(MIXED);
    expect(near(credits.byWorkload.reduce((a, w) => a + w.billableCredits, 0))).toBe(
      near(credits.billableCredits),
    );
  });

  it('reports zero Microsoft credits for a GitHub-only estate', () => {
    const { credits } = runEngine(GITHUB_ONLY);
    expect(credits.billableCredits).toBe(0);
    expect(credits.grossCredits).toBe(0);
    expect(credits.otherMeterBillableCredits).toBeGreaterThan(0);
  });

  it('reports zero other-meter credits for a Microsoft-only estate', () => {
    const { credits } = runEngine(MICROSOFT_ONLY);
    expect(credits.otherMeterBillableCredits).toBe(0);
    expect(credits.otherMeterCostUsd).toBe(0);
    expect(credits.billableCredits).toBeGreaterThan(0);
  });

  it('reconciles each currency total against the sum of its own lines', () => {
    const { credits } = runEngine(MIXED);
    for (const bucket of credits.byCurrency) {
      expect(near(bucket.billableCostUsd)).toBe(
        near(bucket.billableCredits * card.creditCurrencies[bucket.currency].unitUsd),
      );
    }
  });
});

describe('funding options cannot fund the wrong meter', () => {
  it('declares the currencies each option funds, and none funds GitHub', () => {
    const { fundingOptions } = runEngine(MIXED);
    expect(fundingOptions).toHaveLength(8);
    for (const option of fundingOptions) {
      expect(option.fundsCurrencies).not.toContain('github-ai-credit');
      const expected = card.creditCurrencies['microsoft-copilot-credit'].fundableBy.includes(
        option.id,
      );
      expect(option.fundsCurrencies.includes('microsoft-copilot-credit'), option.id).toBe(expected);
    }
    expect(fundingOptions.find((o) => o.id === 'do-nothing')!.fundsCurrencies).toEqual([]);
  });

  it('charges the GitHub bill identically on every option, so it can never sway the choice', () => {
    const { fundingOptions, credits } = runEngine(MIXED);
    expect(credits.otherMeterCostUsd).toBeGreaterThan(0);
    const rows = fundingOptions.map(
      (o) => o.breakdown.find((b) => /another meter|GitHub/i.test(b.label))?.annualUsd,
    );
    for (const [i, row] of rows.entries()) {
      expect(row, fundingOptions[i]!.id).toBeDefined();
      expect(near(row!), fundingOptions[i]!.id).toBe(near(rows[0]!));
    }
    expect(rows[0]!).toBeGreaterThan(0);
  });

  it('never sizes prepaid Microsoft capacity against a GitHub-only estate', () => {
    const { fundingOptions, recommendation } = runEngine(GITHUB_ONLY);
    for (const option of fundingOptions) {
      expect(option.purchasedCredits, option.id).toBe(0);
    }
    // Buying a capacity pack to cover a GitHub bill is the exact error this guards.
    expect(['packs-only', 'p3-packs-payg', 'p3-plus-payg']).not.toContain(
      recommendation.primary.optionId,
    );
  });

  it('still bills the GitHub estate even though no option can fund it, including doing nothing', () => {
    const { fundingOptions, recommendation } = runEngine(GITHUB_ONLY);
    const ghAnnual = runEngine(GITHUB_ONLY).cost.platformLines.find(
      (l) => l.id === 'other-meter-github-ai-credit',
    )!.annualUsd;
    expect(ghAnnual).toBeGreaterThan(0);
    for (const option of fundingOptions) {
      expect(option.twelveMonthTotalUsd, option.id).toBeGreaterThanOrEqual(ghAnnual);
    }
    // Doing nothing must not look free: the overage bills whatever you decide here.
    const doNothing = fundingOptions.find((o) => o.id === 'do-nothing')!;
    expect(doNothing.twelveMonthTotalUsd).toBeGreaterThanOrEqual(ghAnnual);
    expect(recommendation.ranked.find((o) => o.optionId === 'do-nothing')!.blocked).toBe(true);
    expect(recommendation.primary.optionId).not.toBe('do-nothing');
  });
});
