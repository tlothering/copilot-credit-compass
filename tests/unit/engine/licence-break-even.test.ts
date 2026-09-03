import { describe, expect, it } from 'vitest';
import { buildLicenceBreakEven } from '@/lib/engine/licence-break-even';
import { buildCreditModel } from '@/lib/engine/credit-model';
import { buildVolumeModel } from '@/lib/engine/volume-model';
import { normalise } from '@/lib/engine/normalise';
import { normalCdf } from '@/lib/engine/util';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { answersWith, audit, card, near } from './fixtures';

function breakEvenFor(
  workloads: WorkloadId[],
  overrides: Partial<Record<WorkloadId, Record<string, unknown>>> = {},
  patch: Parameters<typeof answersWith>[2] = {},
) {
  const trail = audit();
  const normalised = normalise(answersWith(workloads, overrides, patch), trail);
  const volume = buildVolumeModel(normalised, card, trail);
  const credits = buildCreditModel(volume, card, trail);
  return { model: buildLicenceBreakEven(credits, normalised, card, trail), credits, normalised, trail };
}

const LIGHT_ESTATE = {
  users: 5000,
  m365CopilotLicensedPct: 0,
  messagesPerUserPerDay: 1,
  generativeSharePct: 0,
  graphGroundingPct: 0,
} as const;

describe('the break-even threshold (SPEC §6.3)', () => {
  it('is exactly 3,000 credits on the pay-as-you-go meter', () => {
    const { model } = breakEvenFor(['m365-copilot-chat']);
    expect(model.seatMonthlyUsd).toBe(30);
    expect(near(model.breakEvenCreditsAtPayg)).toBe(3000);
  });

  it('is exactly 3,750 credits against prepaid pack pricing', () => {
    const { model } = breakEvenFor(['m365-copilot-chat']);
    expect(near(model.breakEvenCreditsAtPackRate)).toBe(3750);
  });

  it('derives both thresholds from the rate card, not constants', () => {
    const { model } = breakEvenFor(['m365-copilot-chat']);
    expect(near(model.breakEvenCreditsAtPayg)).toBe(
      near(card.commercial.m365CopilotSeatMonthlyUsd.value / card.commercial.paygCreditUsd.value),
    );
    expect(near(model.breakEvenCreditsAtPackRate)).toBe(
      near(card.commercial.m365CopilotSeatMonthlyUsd.value / card.commercial.capacityPack.effectiveUsdPerCredit),
    );
  });

  it('publishes the threshold as an audit entry', () => {
    const { trail } = breakEvenFor(['m365-copilot-chat']);
    const entry = trail.entries.find((e) => e.step === 'licence:break-even-threshold');
    expect(entry?.output).toBe(3000);
    expect(entry?.outputUnit).toBe('credits/user/month');
    expect(entry?.rateCardRef).toBe('commercial.m365CopilotSeatMonthlyUsd');
    expect(entry?.inputs).toMatchObject({
      m365CopilotSeatMonthlyPrice: 30,
      payAsYouGoCreditPrice: 0.01,
    });
  });
});

describe('the unlicensed internal population', () => {
  it('splits internal users by the weighted licensed share', () => {
    const { model, normalised } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 1000, m365CopilotLicensedPct: 40 },
    });
    expect(model.internalUsers).toBe(normalised.internalUsers);
    expect(model.licensedInternalUsers).toBe(Math.round(1000 * 0.4));
    expect(model.unlicensedInternalUsers).toBe(1000 - 400);
  });

  it('leaves nobody unlicensed at a 100% licensed share', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 500, m365CopilotLicensedPct: 100 },
    });
    expect(model.unlicensedInternalUsers).toBe(0);
    expect(model.usersAboveBreakEven).toBe(0);
    expect(model.shareOfUsersAboveBreakEvenPct).toBe(0);
    expect(model.monthlyMeteredSpendRemovedUsd).toBe(0);
    expect(model.worthwhile).toBe(false);
  });

  it('spreads the offsettable remainder across the unlicensed head count', () => {
    const { model, credits } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 1000, m365CopilotLicensedPct: 20 },
    });
    expect(near(model.creditsPerUnlicensedInternalUserPerMonth)).toBe(
      near(credits.offsettableRemainingCredits / model.unlicensedInternalUsers),
    );
  });
});

describe('the log-normal share above break-even', () => {
  it('matches the closed-form log-normal tail probability', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 1000, m365CopilotLicensedPct: 25 },
    });
    const sigma = card.modelAssumptions.usageDistributionSigma;
    const mu = Math.log(model.creditsPerUnlicensedInternalUserPerMonth) - (sigma * sigma) / 2;
    const expected = 1 - normalCdf((Math.log(model.breakEvenCreditsAtPayg) - mu) / sigma);
    expect(near(model.shareOfUsersAboveBreakEvenPct)).toBe(near(expected * 100));
  });

  it('matches the closed-form conditional expectation for credits carried', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 1000, m365CopilotLicensedPct: 25 },
    });
    const sigma = card.modelAssumptions.usageDistributionSigma;
    const mean = model.creditsPerUnlicensedInternalUserPerMonth;
    const mu = Math.log(mean) - (sigma * sigma) / 2;
    const conditional = normalCdf((mu + sigma * sigma - Math.log(model.breakEvenCreditsAtPayg)) / sigma);
    expect(near(model.creditsRemovedByTargetedShift)).toBe(
      near(model.unlicensedInternalUsers * mean * conditional),
    );
  });

  it('never claims to remove more credits than exist', () => {
    for (const heavy of [10, 100, 1000, 20000]) {
      const { model, credits } = breakEvenFor(['m365-copilot-chat'], {
        'm365-copilot-chat': { users: 200, m365CopilotLicensedPct: 0, messagesPerUserPerDay: heavy },
      });
      expect(model.creditsRemovedByTargetedShift).toBeLessThanOrEqual(
        credits.offsettableRemainingCredits + 1e-6,
      );
    }
  });

  it('drives the share towards 100% as per-user consumption climbs', () => {
    const light = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 5000, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 1 },
    }).model;
    const heavy = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 5000, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 400 },
    }).model;
    expect(heavy.shareOfUsersAboveBreakEvenPct).toBeGreaterThan(
      light.shareOfUsersAboveBreakEvenPct,
    );
    expect(heavy.shareOfUsersAboveBreakEvenPct).toBeLessThanOrEqual(100);
    expect(light.shareOfUsersAboveBreakEvenPct).toBeGreaterThanOrEqual(0);
  });

  it('is zero when there is no offsettable consumption to spread', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 500, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 0 },
    });
    expect(model.creditsPerUnlicensedInternalUserPerMonth).toBe(0);
    expect(model.shareOfUsersAboveBreakEvenPct).toBe(0);
    expect(model.creditsRemovedByTargetedShift).toBe(0);
  });
});

describe('the net benefit test', () => {
  it('nets seat cost off the metered spend removed', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 1000, m365CopilotLicensedPct: 20, messagesPerUserPerDay: 60 },
    });
    expect(near(model.monthlyMeteredSpendRemovedUsd)).toBe(
      near(model.creditsRemovedByTargetedShift * 0.01),
    );
    expect(near(model.annualMeteredSpendRemovedUsd)).toBe(
      near(model.monthlyMeteredSpendRemovedUsd * 12),
    );
    expect(near(model.annualSeatCostUsd)).toBe(near(model.usersAboveBreakEven * 30 * 12));
    expect(near(model.annualNetBenefitUsd)).toBe(
      near(model.annualMeteredSpendRemovedUsd - model.annualSeatCostUsd),
    );
  });

  it('is worthwhile only when the net benefit is positive and someone crosses the line', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 2000, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 120 },
    });
    expect(model.usersAboveBreakEven).toBeGreaterThan(0);
    expect(model.worthwhile).toBe(model.annualNetBenefitUsd > 0);
  });

  it('is not worthwhile for a lightly-used estate', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], { 'm365-copilot-chat': LIGHT_ESTATE }, {
      profile: { knowledgeWorkers: 5000 },
    });
    expect(model.usersAboveBreakEven).toBe(0);
    expect(model.worthwhile).toBe(false);
  });

  it('records the offset opportunity in the audit trail', () => {
    const { model, trail } = breakEvenFor(['m365-copilot-chat']);
    const entry = trail.entries.find((e) => e.step === 'licence:offset-opportunity');
    expect(entry?.output).toBe(model.monthlyMeteredSpendRemovedUsd);
    expect(entry?.inputs.sigma).toBe(card.modelAssumptions.usageDistributionSigma);
    expect(entry?.inputs.breakEvenCredits).toBe(model.breakEvenCreditsAtPayg);
  });
});

describe('external traffic can never be offset', () => {
  it('reports external billable credits separately at the meter price', () => {
    const { model, credits } = breakEvenFor(['copilot-studio-agents'], {
      'copilot-studio-agents': { audience: 'external' },
    });
    expect(model.externalCreditsNeverOffsettable).toBe(credits.externalBillableCredits);
    expect(model.externalCreditsNeverOffsettable).toBeGreaterThan(0);
    expect(near(model.externalMonthlyCostUsd)).toBe(near(credits.externalBillableCredits * 0.01));
  });

  it('records external exposure as its own audit line', () => {
    const { model, trail } = breakEvenFor(['copilot-studio-agents'], {
      'copilot-studio-agents': { audience: 'external' },
    });
    const entry = trail.entries.find((e) => e.step === 'licence:external-exposure');
    expect(entry?.output).toBe(model.externalMonthlyCostUsd);
    expect(entry?.rateCardRef).toBe('commercial.paygCreditUsd');
  });
});

describe('narrative', () => {
  it('always quotes both thresholds', () => {
    const { model } = breakEvenFor(['m365-copilot-chat']);
    expect(model.narrative).toContain('3,000 credits');
    expect(model.narrative).toContain('3,750 credits');
  });

  it('explains a fully-licensed estate', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 400, m365CopilotLicensedPct: 100 },
    });
    expect(model.narrative).toContain('already holds a licence');
  });

  it('mentions residual external spend for a fully-licensed estate that has external traffic', () => {
    const trail = audit();
    const answers = answersWith(['m365-copilot-chat', 'copilot-studio-agents'], {
      'm365-copilot-chat': { users: 400, m365CopilotLicensedPct: 100 },
      'copilot-studio-agents': { audience: 'external', internalUsers: 0 },
    });
    const normalised = normalise(answers, trail);
    const volume = buildVolumeModel(normalised, card, trail);
    const credits = buildCreditModel(volume, card, trail);
    const model = buildLicenceBreakEven(credits, normalised, card, trail);
    if (model.unlicensedInternalUsers === 0 && model.externalMonthlyCostUsd > 0) {
      expect(model.narrative).toContain('no licence can remove');
    }
  });

  it('advises against buying seats when the offset does not pay', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], { 'm365-copilot-chat': LIGHT_ESTATE }, {
      profile: { knowledgeWorkers: 5000 },
    });
    expect(model.worthwhile).toBe(false);
    expect(model.narrative).toContain('cost more than it saves');
    expect(model.narrative).toContain('%');
  });

  it('quantifies the saving when the offset does pay', () => {
    const { model } = breakEvenFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { users: 3000, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 200 },
    });
    expect(model.worthwhile).toBe(true);
    expect(model.narrative).toContain('a month of metered spend');
  });

  it('warns that external traffic stays metered whatever you do', () => {
    const trail = audit();
    const answers = answersWith(['m365-copilot-chat', 'copilot-studio-agents'], {
      'm365-copilot-chat': { users: 3000, m365CopilotLicensedPct: 0, messagesPerUserPerDay: 200 },
      'copilot-studio-agents': { audience: 'external' },
    });
    const normalised = normalise(answers, trail);
    const volume = buildVolumeModel(normalised, card, trail);
    const credits = buildCreditModel(volume, card, trail);
    const model = buildLicenceBreakEven(credits, normalised, card, trail);
    expect(model.worthwhile).toBe(true);
    expect(model.narrative).toContain('stays metered whatever you do');
  });
});
