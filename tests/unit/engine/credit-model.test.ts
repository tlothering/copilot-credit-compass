import { describe, expect, it } from 'vitest';
import { buildCreditModel } from '@/lib/engine/credit-model';
import { buildVolumeModel } from '@/lib/engine/volume-model';
import { normalise } from '@/lib/engine/normalise';
import type { CreditModelOptions, VolumeModel } from '@/lib/engine/types';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { answersWith, audit, card, near } from './fixtures';

function creditsFor(
  workloads: WorkloadId[],
  overrides: Partial<Record<WorkloadId, Record<string, unknown>>> = {},
  options: CreditModelOptions = {},
) {
  const trail = audit();
  const normalised = normalise(answersWith(workloads, overrides), trail);
  const volume = buildVolumeModel(normalised, card, trail);
  return { model: buildCreditModel(volume, card, trail, options), volume, trail };
}

describe('licence offset arithmetic (SPEC §6.3)', () => {
  // 100 users × 10 messages/day × 20 days = 20,000 messages, 100% generative.
  // Gross = 20,000 × 2 credits = 40,000. Licensed 25% → offset 10,000, billable 30,000.
  const overrides = {
    'm365-copilot-chat': {
      users: 100,
      messagesPerUserPerDay: 10,
      businessDaysPerMonth: 20,
      generativeSharePct: 100,
      graphGroundingPct: 0,
      m365CopilotLicensedPct: 25,
    },
  } as const;

  it('offsets exactly the licensed share of internal core activity', () => {
    const { model } = creditsFor(['m365-copilot-chat'], overrides);
    expect(near(model.grossCredits)).toBe(40_000);
    expect(near(model.offsetCredits)).toBe(10_000);
    expect(near(model.billableCredits)).toBe(30_000);
  });

  it.each([
    [0, 40_000],
    [25, 30_000],
    [50, 20_000],
    [75, 10_000],
    [100, 0],
  ])('licensed %d%% → billable %d credits', (m365CopilotLicensedPct, expected) => {
    const { model } = creditsFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { ...overrides['m365-copilot-chat'], m365CopilotLicensedPct },
    });
    expect(near(model.billableCredits)).toBe(expected);
  });

  it('always satisfies gross = offset + billable', () => {
    const { model } = creditsFor([
      'copilot-studio-agents',
      'm365-copilot-chat',
      'voice-agents',
      'ai-tools',
      'retrieval-api',
    ]);
    expect(near(model.grossCredits)).toBe(near(model.offsetCredits + model.billableCredits));
  });

  it('never offsets external traffic no matter the licence position', () => {
    const { model } = creditsFor(['copilot-studio-agents'], {
      'copilot-studio-agents': {
        audience: 'external',
        externalTrafficPct: 100,
        m365CopilotLicensedPct: 100,
      },
    });
    expect(model.offsetCredits).toBe(0);
    expect(near(model.billableCredits)).toBe(near(model.grossCredits));
    expect(near(model.externalBillableCredits)).toBe(near(model.grossCredits));
  });

  it('splits a mixed audience in proportion to the external share', () => {
    // 50% external → half the gross is external and unoffsettable.
    const { model } = creditsFor(['copilot-studio-agents'], {
      'copilot-studio-agents': {
        audience: 'both',
        externalTrafficPct: 50,
        m365CopilotLicensedPct: 100,
      },
    });
    expect(near(model.externalBillableCredits)).toBe(near(model.grossCredits * 0.5));
    expect(near(model.offsetCredits)).toBe(near(model.grossCredits * 0.5));
  });
});

describe('rates that a licence never offsets', () => {
  it('meters voice minutes in full even at 100% licence coverage', () => {
    expect(card.consumption['voice-genai-minute'].offsetByM365CopilotLicence).toBe(false);
    const { model } = creditsFor(
      ['voice-agents'],
      { 'voice-agents': { tier: 'genai' } },
      { assumeAllInternalLicensed: true },
    );
    expect(model.offsetCredits).toBe(0);
    expect(model.billableCredits).toBeGreaterThan(0);
  });

  it('meters retrieval API queries in full', () => {
    const { model } = creditsFor(
      ['retrieval-api'],
      { 'retrieval-api': { queriesPerMonth: 10_000 } },
      { assumeAllInternalLicensed: true },
    );
    const rate = card.consumption['retrieval-api-query'].credits;
    expect(near(model.billableCredits)).toBe(10_000 * rate);
    expect(model.offsettableRemainingCredits).toBe(0);
  });

  it('meters GitHub premium-request overage in full', () => {
    const { model } = creditsFor(
      ['github-copilot'],
      { 'github-copilot': { seats: 1000, plan: 'business', heavyUserPct: 100, modelTier: 'premium' } },
      { assumeAllInternalLicensed: true },
    );
    expect(model.offsetCredits).toBe(0);
  });
});

describe('credit model options', () => {
  it('assumeAllInternalLicensed drives offsettable internal traffic to zero', () => {
    const workloads: WorkloadId[] = ['m365-copilot-chat', 'copilot-studio-agents'];
    const base = creditsFor(workloads).model;
    const shifted = creditsFor(workloads, {}, { assumeAllInternalLicensed: true }).model;
    expect(shifted.billableCredits).toBeLessThan(base.billableCredits);
    expect(near(shifted.offsettableRemainingCredits)).toBe(0);
    expect(near(shifted.grossCredits)).toBe(near(base.grossCredits));
  });

  it('byomZeroRateGenerative removes generative-answer credits only', () => {
    const overrides = {
      'm365-copilot-chat': {
        users: 100,
        messagesPerUserPerDay: 10,
        businessDaysPerMonth: 20,
        generativeSharePct: 50,
        graphGroundingPct: 0,
        m365CopilotLicensedPct: 0,
      },
    } as const;
    const base = creditsFor(['m365-copilot-chat'], overrides).model;
    const byom = creditsFor(['m365-copilot-chat'], overrides, { byomZeroRateGenerative: true }).model;

    // 10,000 generative × 2 = 20,000 credits removed; 10,000 classic × 1 = 10,000 remain.
    expect(near(base.billableCredits)).toBe(30_000);
    expect(near(byom.billableCredits)).toBe(10_000);
    const generativeLine = byom.lines.find((l) => l.rateId === 'generative-answer');
    expect(generativeLine?.creditsPerUnit).toBe(0);
    const classicLine = byom.lines.find((l) => l.rateId === 'classic-answer');
    expect(classicLine?.creditsPerUnit).toBe(1);
  });

  it('defaults to no options without throwing', () => {
    expect(() => creditsFor(['m365-copilot-chat'])).not.toThrow();
  });
});

describe('credit model aggregates', () => {
  it('tracks internal, external and remaining-offsettable separately', () => {
    // retrieval-api is internal but not offsettable, so the two internal figures diverge.
    const { model } = creditsFor(['retrieval-api'], { 'retrieval-api': { queriesPerMonth: 1_000 } });
    expect(model.internalBillableCredits).toBeGreaterThan(0);
    expect(model.externalBillableCredits).toBe(0);
    expect(model.offsettableRemainingCredits).toBe(0);
  });

  it('rolls up by workload consistently with the line detail', () => {
    const { model } = creditsFor(['copilot-studio-agents', 'm365-copilot-chat', 'voice-agents']);
    for (const roll of model.byWorkload) {
      const lines = model.lines.filter((l) => l.workloadId === roll.workloadId);
      expect(near(roll.grossCredits)).toBe(near(lines.reduce((a, l) => a + l.grossCredits, 0)));
      expect(near(roll.billableCredits)).toBe(near(lines.reduce((a, l) => a + l.billableCredits, 0)));
    }
  });

  it('returns all-zero totals for an empty volume model', () => {
    const empty: VolumeModel = { lines: [], totalsByWorkload: {} };
    const model = buildCreditModel(empty, card, audit());
    expect(model).toMatchObject({
      grossCredits: 0,
      offsetCredits: 0,
      billableCredits: 0,
      internalBillableCredits: 0,
      externalBillableCredits: 0,
      offsettableRemainingCredits: 0,
      byWorkload: [],
      lines: [],
    });
  });
});

describe('credit model audit trail', () => {
  it('emits one entry per line plus a total, each with the full required shape', () => {
    const { model, trail } = creditsFor(['m365-copilot-chat']);
    for (const l of model.lines) {
      const entry = trail.entries.find((e) => e.step === `credits:${l.lineId}`);
      expect(entry, l.lineId).toBeDefined();
      expect(entry!.formula).toContain('billable =');
      expect(entry!.rateCardRef).toBe(`consumption.${l.rateId}`);
      expect(entry!.output).toBe(l.billableCredits);
      expect(entry!.outputUnit).toBe('credits/month');
    }
    const total = trail.entries.find((e) => e.step === 'credits:total');
    expect(total?.output).toBe(model.billableCredits);
  });

  it('uses the non-offset wording for rates a licence cannot offset', () => {
    const { trail } = creditsFor(['voice-agents'], { 'voice-agents': { tier: 'classic' } });
    const entry = trail.entries.find((e) => e.step === 'credits:voice-agents:minutes');
    expect(entry?.formula).toContain('never offset');
  });

  it('exposes the human-readable display rate for every line', () => {
    const { trail } = creditsFor(['copilot-studio-agents']);
    const entry = trail.entries.find((e) => e.step === 'credits:copilot-studio-agents:classic');
    expect(entry?.inputs.displayRate).toBeTruthy();
  });
});
