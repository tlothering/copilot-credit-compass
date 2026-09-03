import { describe, expect, it } from 'vitest';
import { buildCostModel } from '@/lib/engine/cost-model';
import { buildCreditModel } from '@/lib/engine/credit-model';
import { buildVolumeModel } from '@/lib/engine/volume-model';
import { normalise } from '@/lib/engine/normalise';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { answersWith, audit, card, near } from './fixtures';

function costFor(
  workloads: WorkloadId[],
  overrides: Partial<Record<WorkloadId, Record<string, unknown>>> = {},
  patch: Parameters<typeof answersWith>[2] = {},
) {
  const trail = audit();
  const normalised = normalise(answersWith(workloads, overrides, patch), trail);
  const volume = buildVolumeModel(normalised, card, trail);
  const credits = buildCreditModel(volume, card, trail);
  return { model: buildCostModel(credits, normalised, card, trail), credits, trail };
}

const platform = (m: ReturnType<typeof costFor>['model'], id: string) =>
  m.platformLines.find((l) => l.id === id);

describe('metered credit cost', () => {
  it('is billable credits at the pay-as-you-go price', () => {
    const { model, credits } = costFor(['m365-copilot-chat']);
    expect(near(model.meteredCreditCostUsd)).toBe(near(credits.billableCredits * 0.01));
  });

  it('reports the effective USD per credit', () => {
    const { model } = costFor(['m365-copilot-chat']);
    expect(near(model.effectiveUsdPerCredit)).toBe(0.01);
  });

  it('returns a zero effective rate rather than NaN when there is no demand', () => {
    const { model } = costFor([]);
    expect(model.meteredCreditCostUsd).toBe(0);
    expect(model.effectiveUsdPerCredit).toBe(0);
    expect(model.totalMonthlyUsd).toBe(0);
    expect(model.platformLines).toEqual([]);
  });
});

describe('Microsoft 365 Copilot seats', () => {
  it('prices the month-12 seat count at the rate-card seat price', () => {
    const { model } = costFor(['m365-copilot'], { 'm365-copilot': { seatsNow: 100, seats12m: 400 } });
    const l = platform(model, 'm365-copilot-seats');
    expect(l?.monthlyUsd).toBe(400 * 30);
    expect(l?.annualUsd).toBe(400 * 30 * 12);
    expect(l?.rateCardRef).toBe('commercial.m365CopilotSeatMonthlyUsd');
    expect(model.m365CopilotSeatsHeld).toBe(400);
  });

  it('reports zero seats held when the workload is not selected', () => {
    const { model } = costFor(['m365-copilot-chat']);
    expect(model.m365CopilotSeatsHeld).toBe(0);
    expect(platform(model, 'm365-copilot-seats')).toBeUndefined();
  });
});

describe('GitHub Copilot seats', () => {
  it.each([
    ['business', 19],
    ['enterprise', 39],
  ] as const)('%s seats cost $%d each', (plan, price) => {
    const { model } = costFor(['github-copilot'], { 'github-copilot': { seats: 50, plan } });
    expect(platform(model, 'github-copilot-seats')?.monthlyUsd).toBe(50 * price);
    expect(platform(model, 'github-copilot-seats')?.rateCardRef).toBe(`commercial.githubCopilot.${plan}`);
  });
});

describe('Security Copilot SCUs', () => {
  it('never provisions below the rate-card minimum', () => {
    const { model } = costFor(['security-copilot'], {
      'security-copilot': { investigationsPerDay: 1, scuMinutesPerInvestigation: 1, coverage: '24x7' },
    });
    const l = platform(model, 'security-copilot-scu');
    const minimum = card.commercial.securityCopilot.minimumScu;
    const hours = card.modelAssumptions.hoursPerMonth;
    expect(l?.monthlyUsd).toBeGreaterThanOrEqual(
      minimum * hours * card.commercial.securityCopilot.provisionedScuHourUsd,
    );
    expect(l?.note).toContain(`${minimum} SCU`);
  });

  it('costs more at 24x7 coverage than business hours for the same workload', () => {
    const usage = { investigationsPerDay: 40, scuMinutesPerInvestigation: 15 };
    const roundClock = costFor(['security-copilot'], {
      'security-copilot': { ...usage, coverage: '24x7' },
    }).model;
    const businessHours = costFor(['security-copilot'], {
      'security-copilot': { ...usage, coverage: 'business-hours' },
    }).model;
    expect(platform(roundClock, 'security-copilot-scu')!.monthlyUsd).toBeGreaterThan(
      platform(businessHours, 'security-copilot-scu')!.monthlyUsd,
    );
  });

  it('scales the burst allowance with declared confidence', () => {
    const usage = { investigationsPerDay: 200, scuMinutesPerInvestigation: 30, coverage: '24x7' };
    const low = costFor(['security-copilot'], { 'security-copilot': usage }, {
      growth: { confidence: 'low' },
    }).model;
    const high = costFor(['security-copilot'], { 'security-copilot': usage }, {
      growth: { confidence: 'high' },
    }).model;
    expect(platform(low, 'security-copilot-scu')!.monthlyUsd).toBeGreaterThanOrEqual(
      platform(high, 'security-copilot-scu')!.monthlyUsd,
    );
  });

  it('never contributes credits — only platform dollars', () => {
    const { model, credits } = costFor(['security-copilot']);
    expect(credits.grossCredits).toBe(0);
    expect(model.platformMonthlyUsd).toBeGreaterThan(0);
  });

  it('records the deployment shape in the audit trail for transparency', () => {
    const { trail } = costFor(['security-copilot'], { 'security-copilot': { deployment: 'embedded' } });
    const entry = trail.entries.find((e) => e.step === 'cost:security-copilot');
    expect(entry?.inputs.deployment).toBe('embedded');
  });
});

describe('Foundry / BYOM tokens', () => {
  it('prices input and output tokens separately per million', () => {
    const { model } = costFor(['foundry-byom'], {
      'foundry-byom': { inputTokensPerMonth: 2_000_000, outputTokensPerMonth: 1_000_000 },
    });
    const f = card.commercial.foundry;
    const expected = 2 * f.inputPerMillionTokensUsd + 1 * f.outputPerMillionTokensUsd;
    expect(near(platform(model, 'foundry-tokens')!.monthlyUsd)).toBe(near(expected));
  });

  it('is flagged as an Azure meter, distinct from Copilot Credits', () => {
    const { model } = costFor(['foundry-byom']);
    expect(platform(model, 'foundry-tokens')?.note).toMatch(/Azure/i);
  });
});

describe('cost model aggregation', () => {
  it('total = metered credits + every platform line', () => {
    const { model } = costFor([
      'm365-copilot',
      'm365-copilot-chat',
      'github-copilot',
      'security-copilot',
      'foundry-byom',
    ]);
    const summed = model.platformLines.reduce((a, l) => a + l.monthlyUsd, 0);
    expect(near(model.platformMonthlyUsd)).toBe(near(summed));
    expect(near(model.platformAnnualUsd)).toBe(near(summed * 12));
    expect(near(model.totalMonthlyUsd)).toBe(near(model.meteredCreditCostUsd + summed));
  });

  it('gives every platform line a rate-card reference', () => {
    const { model } = costFor(['m365-copilot', 'github-copilot', 'security-copilot', 'foundry-byom']);
    expect(model.platformLines).toHaveLength(4);
    for (const l of model.platformLines) {
      expect(l.rateCardRef, l.id).toMatch(/^commercial\./);
      expect(near(l.annualUsd), l.id).toBe(near(l.monthlyUsd * 12));
    }
  });

  it('emits the metered-credit audit entry with the pay-as-you-go reference', () => {
    const { trail } = costFor(['m365-copilot-chat']);
    const entry = trail.entries.find((e) => e.step === 'cost:metered-credits');
    expect(entry?.rateCardRef).toBe('commercial.paygCreditUsd');
    expect(entry?.outputUnit).toBe('USD/month');
  });
});
