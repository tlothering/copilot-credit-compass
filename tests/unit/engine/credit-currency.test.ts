import { describe, expect, it } from 'vitest';
import { runEngine } from '@/lib/engine';
import { WORKLOADS } from '@/lib/schemas/taxonomy';
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
/**
 * A GitHub estate whose consumption sits *inside* the pooled allowance, so there is no
 * overage line at all — only the seat bill.
 *
 * This is the case that defeated the previous fix. That fix identified unavoidable spend
 * by testing for an `other-meter-` id prefix, which the overage line carries and the seat
 * line does not. With an overage line present the guard appeared to work; with only a seat
 * line, unavoidable spend collapsed to zero and "do nothing" reported $0 against a real
 * seven-figure bill.
 */
const GITHUB_ONLY_NO_OVERAGE = flatAnswers(['github-copilot'], {
  'github-copilot': { seats: 2000, plan: 'enterprise', heavyUserPct: 10, modelTier: 'economy' },
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
    const { fundingOptions, cost } = runEngine(GITHUB_ONLY);
    const ghOverage = cost.platformLines.find((l) => l.id === 'other-meter-github-ai-credit');
    const ghSeats = cost.platformLines.find((l) => l.id === 'github-copilot-seats');
    expect(ghSeats!.annualUsd).toBeGreaterThan(0);

    const doNothing = fundingOptions.find((o) => o.id === 'do-nothing')!;

    // The seat bill is the line that was missed: it is not prefixed `other-meter-`, so a
    // filter keyed on that prefix silently dropped it and handed "do nothing" a saving
    // that does not exist. Doing nothing cancels no subscription.
    expect(doNothing.platformCostUsd).toBe(cost.platformAnnualUsd);
    expect(doNothing.platformCostUsd).toBeGreaterThanOrEqual(ghSeats!.annualUsd);
    if (ghOverage) {
      expect(doNothing.platformCostUsd).toBeGreaterThanOrEqual(
        ghSeats!.annualUsd + ghOverage.annualUsd,
      );
    }

    // The real invariant, stronger than any blocking rule: declining to fund credits can
    // never come out cheaper than funding them, because the platform base is identical
    // across all eight options and only the credit funding varies.
    for (const option of fundingOptions) {
      expect(option.twelveMonthTotalUsd, option.id).toBeGreaterThanOrEqual(
        doNothing.twelveMonthTotalUsd - 1e-6,
      );
    }

    // Every platform line must appear in the breakdown, so the number is explainable.
    for (const line of cost.platformLines) {
      expect(
        doNothing.breakdown.some((b) => b.label === line.label),
        line.id,
      ).toBe(true);
    }
  });

  it('does not pretend a Microsoft funding instrument helps an estate with no Microsoft demand', () => {
    const { credits, fundingOptions, recommendation } = runEngine(GITHUB_ONLY);
    expect(credits.billableCredits).toBe(0);

    // Every option costs the same, because there is no Microsoft credit demand for any
    // of them to fund. Quoting a capacity pack here would be quoting for capacity that
    // can never be drawn against, so both pack options must be ruled out by name.
    const totals = fundingOptions.map((o) => o.twelveMonthTotalUsd);
    for (const total of totals) expect(near(total)).toBe(near(totals[0]!));

    for (const id of ['packs-only', 'packs-plus-payg'] as const) {
      const option = fundingOptions.find((o) => o.id === id)!;
      expect(option.eligible, id).toBe(false);
      expect(option.ineligibleReasons.join(' '), id).toMatch(/no Microsoft credit demand/i);
      expect(recommendation.ranked.find((r) => r.optionId === id)!.blocked, id).toBe(true);
    }
  });
});

describe('a seat bill with no overage is still unavoidable spend', () => {
  it('has a seat line and no overage line, which is what made this case slip through', () => {
    const { cost, credits } = runEngine(GITHUB_ONLY_NO_OVERAGE);
    expect(credits.billableCredits).toBe(0);
    expect(cost.platformLines.find((l) => l.id.startsWith('other-meter-'))).toBeUndefined();
    const seats = cost.platformLines.find((l) => l.id === 'github-copilot-seats')!;
    expect(seats.annualUsd).toBeGreaterThan(0);
    // Nothing in the platform set carries the prefix the old filter looked for, so that
    // filter would have summed to zero here.
    expect(
      cost.platformLines
        .filter((l) => l.id.startsWith('other-meter-'))
        .reduce((a, l) => a + l.annualUsd, 0),
    ).toBe(0);
  });

  it('never reports doing nothing as free while a seat bill is running', () => {
    const { cost, fundingOptions } = runEngine(GITHUB_ONLY_NO_OVERAGE);
    const doNothing = fundingOptions.find((o) => o.id === 'do-nothing')!;
    expect(cost.platformAnnualUsd).toBeGreaterThan(0);
    expect(doNothing.twelveMonthTotalUsd).toBe(cost.platformAnnualUsd);
    expect(doNothing.meta?.unavoidableAnnualUsd).toBe(cost.platformAnnualUsd);
    expect(doNothing.cashFlowShape).not.toBe('none');
  });

  it('never lets doing nothing undercut an option that funds the same estate', () => {
    const { fundingOptions } = runEngine(GITHUB_ONLY_NO_OVERAGE);
    const doNothing = fundingOptions.find((o) => o.id === 'do-nothing')!;
    for (const option of fundingOptions) {
      expect(option.twelveMonthTotalUsd, option.id).toBeGreaterThanOrEqual(
        doNothing.twelveMonthTotalUsd - 1e-6,
      );
    }
  });

  it('holds for every estate shape, not just the GitHub ones', () => {
    // The property is general: doing nothing funds no credits, so it can never be
    // cheaper than an option that does, and it can never shed a platform line.
    for (const [name, answers] of [
      ['github-only-no-overage', GITHUB_ONLY_NO_OVERAGE],
      ['github-only-overage', GITHUB_ONLY],
      ['microsoft-only', MICROSOFT_ONLY],
      ['mixed', MIXED],
    ] as const) {
      const { cost, fundingOptions } = runEngine(answers);
      const doNothing = fundingOptions.find((o) => o.id === 'do-nothing')!;
      expect(doNothing.platformCostUsd, name).toBe(cost.platformAnnualUsd);
      expect(doNothing.creditFundingUsd, name).toBe(0);
      for (const option of fundingOptions) {
        expect(option.twelveMonthTotalUsd, `${name}/${option.id}`).toBeGreaterThanOrEqual(
          doNothing.twelveMonthTotalUsd - 1e-6,
        );
      }
    }
  });
});

describe('workload picker meter chips match what the engine bills', () => {
  // The chip on each workload card in step 2 is derived from WorkloadMeta.creditMeter.
  // If a workload's engine output ever moves to a different meter, the card would keep
  // showing the old meter name to the user. This pins the two together.
  const metered = WORKLOADS.filter((w) => w.meteredInCredits);

  it('covers every credit-metered workload', () => {
    expect(metered.length).toBeGreaterThan(5);
  });

  it.each(metered.map((w) => [w.id, w.creditMeter ?? 'microsoft-copilot-credit'] as const))(
    '%s bills on the %s meter',
    (id, declared) => {
      const answers = flatAnswers([id], {
        'github-copilot': {
          seats: 400,
          plan: 'business',
          heavyUserPct: 100,
          modelTier: 'premium',
        },
      });
      const { credits } = runEngine(answers);
      const own = credits.lines.filter((l) => l.workloadId === id);
      expect(own.length, `${id} produced no credit lines`).toBeGreaterThan(0);
      for (const line of own) {
        expect(line.currency, `${id} line "${line.label}"`).toBe(declared);
      }
    },
  );

  it('names the GitHub meter distinctly from the Microsoft one', () => {
    const gh = card.creditCurrencies['github-ai-credit'].label;
    const ms = card.creditCurrencies['microsoft-copilot-credit'].label;
    expect(gh).not.toBe(ms);
    expect(gh).toMatch(/GitHub/i);
  });
});
