import { describe, expect, it } from 'vitest';
import { buildVolumeModel } from '@/lib/engine/volume-model';
import { normalise } from '@/lib/engine/normalise';
import { consumptionRate } from '@/lib/engine/rate-card';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { answersWith, audit, card, near } from './fixtures';

function volumeFor(
  workloads: WorkloadId[],
  overrides: Partial<Record<WorkloadId, Record<string, unknown>>> = {},
  patch: Parameters<typeof answersWith>[2] = {},
) {
  const trail = audit();
  const normalised = normalise(answersWith(workloads, overrides, patch), trail);
  return { model: buildVolumeModel(normalised, card, trail), trail };
}

const line = (model: ReturnType<typeof volumeFor>['model'], lineId: string) => {
  const found = model.lines.find((l) => l.lineId === lineId);
  if (!found) throw new Error(`no volume line "${lineId}" (have: ${model.lines.map((l) => l.lineId).join(', ')})`);
  return found;
};

describe('Copilot Studio custom agents', () => {
  // 10 agents × 100 conversations/day × 20 business days = 20,000 conversations
  // × 5 turns = 100,000 turns.
  const overrides = {
    'copilot-studio-agents': {
      agents12m: 10,
      conversationsPerAgentPerDay: 100,
      businessDaysPerMonth: 20,
      turnsPerConversation: 5,
      mixClassicPct: 30,
      mixGenerativePct: 50,
      mixActionPct: 20,
      graphGroundingPct: 25,
      triggersFlows: true,
      flowActionsPerConversation: 2,
      audience: 'internal',
      externalTrafficPct: 0,
      m365CopilotLicensedPct: 40,
    },
  } as const;

  it.each([
    ['copilot-studio-agents:classic', 30_000, 'classic-answer'],
    ['copilot-studio-agents:generative', 50_000, 'generative-answer'],
    ['copilot-studio-agents:actions', 20_000, 'agent-action'],
    ['copilot-studio-agents:grounding', 25_000, 'tenant-graph-grounding'],
    ['copilot-studio-agents:flow-actions', 40_000, 'agent-flow-action'],
  ])('%s = %d units', (lineId, expected, rateId) => {
    const { model } = volumeFor(['copilot-studio-agents'], overrides);
    const l = line(model, lineId);
    expect(l.quantity).toBe(expected);
    expect(l.rateId).toBe(rateId);
  });

  it('zeroes flow actions when the agents do not trigger flows', () => {
    const { model } = volumeFor(['copilot-studio-agents'], {
      'copilot-studio-agents': { ...overrides['copilot-studio-agents'], triggersFlows: false },
    });
    expect(line(model, 'copilot-studio-agents:flow-actions').quantity).toBe(0);
  });

  it.each([
    ['internal', 0, 1],
    ['external', 0, 0],
    ['both', 35, 0.65],
  ] as const)('audience=%s externalPct=%d → internalShare %s', (audience, pct, expected) => {
    const { model } = volumeFor(['copilot-studio-agents'], {
      'copilot-studio-agents': { ...overrides['copilot-studio-agents'], audience, externalTrafficPct: pct },
    });
    expect(near(line(model, 'copilot-studio-agents:classic').internalShare)).toBe(expected);
  });

  it('carries the licensed share of internal traffic onto every line', () => {
    const { model } = volumeFor(['copilot-studio-agents'], overrides);
    for (const l of model.lines) expect(l.licensedShareOfInternal).toBe(0.4);
  });

  it('records the conversation and turn intermediates in the audit trail', () => {
    const { trail } = volumeFor(['copilot-studio-agents'], overrides);
    const conv = trail.entries.find((e) => e.step === 'volume:copilot-studio-agents:conversations');
    const turns = trail.entries.find((e) => e.step === 'volume:copilot-studio-agents:turns');
    expect(conv?.output).toBe(20_000);
    expect(turns?.output).toBe(100_000);
  });
});

describe('Microsoft 365 Copilot Chat', () => {
  // 500 users × 4 messages/day × 20 days = 40,000 messages.
  const overrides = {
    'm365-copilot-chat': {
      users: 500,
      messagesPerUserPerDay: 4,
      businessDaysPerMonth: 20,
      generativeSharePct: 75,
      graphGroundingPct: 30,
      m365CopilotLicensedPct: 20,
    },
  } as const;

  it.each([
    ['m365-copilot-chat:generative', 30_000],
    ['m365-copilot-chat:classic', 10_000],
    ['m365-copilot-chat:grounding', 12_000],
  ])('%s = %d', (lineId, expected) => {
    const { model } = volumeFor(['m365-copilot-chat'], overrides);
    expect(near(line(model, lineId).quantity)).toBe(expected);
  });

  it('is always fully internal', () => {
    const { model } = volumeFor(['m365-copilot-chat'], overrides);
    for (const l of model.lines) expect(l.internalShare).toBe(1);
  });

  it('splits entirely to classic at 0% generative and entirely to generative at 100%', () => {
    const zero = volumeFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { ...overrides['m365-copilot-chat'], generativeSharePct: 0 },
    }).model;
    expect(line(zero, 'm365-copilot-chat:generative').quantity).toBe(0);
    expect(line(zero, 'm365-copilot-chat:classic').quantity).toBe(40_000);

    const full = volumeFor(['m365-copilot-chat'], {
      'm365-copilot-chat': { ...overrides['m365-copilot-chat'], generativeSharePct: 100 },
    }).model;
    expect(line(full, 'm365-copilot-chat:generative').quantity).toBe(40_000);
    expect(near(line(full, 'm365-copilot-chat:classic').quantity)).toBe(0);
  });
});

describe('SharePoint agents', () => {
  // 8 agents × 50 users × 3 messages/day × 20 days = 24,000 messages.
  it('multiplies agents, users, messages and business days', () => {
    const { model } = volumeFor(['sharepoint-agents'], {
      'sharepoint-agents': {
        agentCount: 8,
        usersPerAgent: 50,
        messagesPerUserPerDay: 3,
        businessDaysPerMonth: 20,
        graphGroundingPct: 50,
      },
    });
    expect(line(model, 'sharepoint-agents:generative').quantity).toBe(24_000);
    expect(line(model, 'sharepoint-agents:generative').rateId).toBe('generative-answer');
    expect(line(model, 'sharepoint-agents:grounding').quantity).toBe(12_000);
  });
});

describe('Copilot Studio agent flows', () => {
  it('is flowRuns × actionsPerRun', () => {
    const { model } = volumeFor(['copilot-studio-flows'], {
      'copilot-studio-flows': { flowRunsPerMonth: 12_000, actionsPerRun: 5, m365CopilotLicensedPct: 60 },
    });
    const l = line(model, 'copilot-studio-flows:actions');
    expect(l.quantity).toBe(60_000);
    expect(l.rateId).toBe('agent-flow-action');
    expect(l.licensedShareOfInternal).toBe(0.6);
  });
});

describe('Voice agents', () => {
  // 100 calls/day × 20 days × 5 min AHT × (0.7 + 0.3 × 0.5 = 0.85) = 8,500 minutes.
  const base = {
    callsPerDay: 100,
    businessDaysPerMonth: 20,
    avgHandleTimeMinutes: 5,
    containmentRatePct: 70,
  } as const;

  it('applies the escalated-call handle share to non-contained calls', () => {
    expect(card.modelAssumptions.escalatedCallHandleShare).toBe(0.5);
    const { model } = volumeFor(['voice-agents'], { 'voice-agents': { ...base, tier: 'genai' } });
    expect(near(line(model, 'voice-agents:minutes').quantity)).toBe(8_500);
  });

  it.each([
    ['classic', 'voice-classic-minute'],
    ['genai', 'voice-genai-minute'],
    ['premium-genai', 'voice-premium-genai-minute'],
  ] as const)('tier %s maps to rate %s', (tier, rateId) => {
    const { model } = volumeFor(['voice-agents'], { 'voice-agents': { ...base, tier } });
    expect(line(model, 'voice-agents:minutes').rateId).toBe(rateId);
  });

  it('is never internal, so no licence can ever offset it', () => {
    const { model } = volumeFor(['voice-agents'], { 'voice-agents': { ...base, tier: 'genai' } });
    const l = line(model, 'voice-agents:minutes');
    expect(l.internalShare).toBe(0);
    expect(l.licensedShareOfInternal).toBe(0);
  });

  it('bills every minute at 100% containment and half the escalations at 0%', () => {
    const full = volumeFor(['voice-agents'], {
      'voice-agents': { ...base, tier: 'genai', containmentRatePct: 100 },
    }).model;
    expect(near(line(full, 'voice-agents:minutes').quantity)).toBe(10_000);

    const none = volumeFor(['voice-agents'], {
      'voice-agents': { ...base, tier: 'genai', containmentRatePct: 0 },
    }).model;
    expect(near(line(none, 'voice-agents:minutes').quantity)).toBe(5_000);
  });
});

describe('AI tools / AI Builder', () => {
  // 1,000 docs × 6 pages = 6,000 pages; 10,000 responses × 900 tokens ÷ 1000 = 9,000 1K-token units.
  const base = {
    documentsPerMonth: 1_000,
    pagesPerDocument: 6,
    responsesPerMonth: 10_000,
    tokensPerResponse: 900,
  } as const;

  it('computes pages and thousand-token units', () => {
    const { model } = volumeFor(['ai-tools'], { 'ai-tools': { ...base, modelTier: 'standard' } });
    expect(line(model, 'ai-tools:content-processing').quantity).toBe(6_000);
    expect(line(model, 'ai-tools:content-processing').rateId).toBe('content-processing-page');
    expect(line(model, 'ai-tools:tokens').quantity).toBe(9_000);
  });

  it.each([
    ['basic', 'ai-tools-basic-tokens'],
    ['standard', 'ai-tools-standard-tokens'],
    ['premium', 'ai-tools-premium-tokens'],
  ] as const)('model tier %s bills on the %s meter', (modelTier, rateId) => {
    const { model } = volumeFor(['ai-tools'], { 'ai-tools': { ...base, modelTier } });
    expect(line(model, 'ai-tools:tokens').rateId).toBe(rateId);
  });

  it('bills tokens only — the per-response rate is never double-counted', () => {
    const { model } = volumeFor(['ai-tools'], { 'ai-tools': { ...base, modelTier: 'standard' } });
    const responseLines = model.lines.filter((l) => l.rateId.endsWith('-response'));
    expect(responseLines).toEqual([]);
  });
});

describe('Dynamics 365 out-of-box agents', () => {
  // 200 users × 4 invocations/day × 20 days = 16,000 invocations; × 2 actions = 32,000.
  it('derives invocations and actions', () => {
    const { model } = volumeFor(['d365-agents'], {
      'd365-agents': {
        users: 200,
        invocationsPerUserPerDay: 4,
        businessDaysPerMonth: 20,
        actionsPerInvocation: 2,
      },
    });
    expect(line(model, 'd365-agents:generative').quantity).toBe(16_000);
    expect(line(model, 'd365-agents:actions').quantity).toBe(32_000);
  });
});

describe('Role-based Copilots', () => {
  // 100 users × 5 interactions/day × 20 days = 10,000; × 3 actions = 30,000.
  it('derives interactions and actions', () => {
    const { model } = volumeFor(['role-based-copilots'], {
      'role-based-copilots': {
        users: 100,
        interactionsPerUserPerDay: 5,
        businessDaysPerMonth: 20,
        actionsPerInteraction: 3,
      },
    });
    expect(line(model, 'role-based-copilots:generative').quantity).toBe(10_000);
    expect(line(model, 'role-based-copilots:actions').quantity).toBe(30_000);
  });
});

describe('Copilot Cowork', () => {
  it('is users × tasks per user per month', () => {
    const { model } = volumeFor(['copilot-cowork'], {
      'copilot-cowork': { users: 150, tasksPerUserPerMonth: 12 },
    });
    const l = line(model, 'copilot-cowork:tasks');
    expect(l.quantity).toBe(1_800);
    expect(l.rateId).toBe('cowork-task');
  });

  it('is not zero-rated by a Microsoft 365 Copilot licence', () => {
    // Cowork draws Copilot Credits against the Microsoft 365 usage-based
    // billing limit, unlike core Copilot Studio agent activity.
    expect(consumptionRate(card, 'cowork-task').offsetByM365CopilotLicence).toBe(false);
    expect(consumptionRate(card, 'cowork-task').offsetNote).toBeTruthy();

    const withLicences = volumeFor(['copilot-cowork'], {
      'copilot-cowork': { users: 150, tasksPerUserPerMonth: 12, m365CopilotLicensedPct: 100 },
    });
    const without = volumeFor(['copilot-cowork'], {
      'copilot-cowork': { users: 150, tasksPerUserPerMonth: 12, m365CopilotLicensedPct: 0 },
    });
    expect(line(withLicences.model, 'copilot-cowork:tasks').quantity).toBe(
      line(without.model, 'copilot-cowork:tasks').quantity,
    );
  });
});

describe('Foundry BYOM', () => {
  it('bills agent actions on the credit meter; inference is Azure, not credits', () => {
    const { model } = volumeFor(['foundry-byom'], {
      'foundry-byom': { agentActionsPerMonth: 25_000 },
    });
    const l = line(model, 'foundry-byom:actions');
    expect(l.quantity).toBe(25_000);
    expect(l.rateId).toBe('agent-action');
    expect(model.lines.some((x) => x.rateId.includes('token'))).toBe(false);
  });
});

describe('Retrieval API', () => {
  it('is metered regardless of licence', () => {
    const { model } = volumeFor(['retrieval-api'], { 'retrieval-api': { queriesPerMonth: 40_000 } });
    const l = line(model, 'retrieval-api:queries');
    expect(l.quantity).toBe(40_000);
    expect(l.internalShare).toBe(1);
    expect(l.licensedShareOfInternal).toBe(0);
  });
});

describe('GitHub Copilot', () => {
  const heavy = card.modelAssumptions.githubAiCreditsPerHeavyUserPerMonth;
  const standard = card.modelAssumptions.githubAiCreditsPerStandardUserPerMonth;
  const plans = card.commercial.githubCopilot.plans;

  it('bills only the AI credits beyond the pooled included allowance', () => {
    const seats = 100;
    const { model } = volumeFor(['github-copilot'], {
      'github-copilot': { seats, plan: 'business', heavyUserPct: 50, modelTier: 'standard' },
    });
    const perUser = 0.5 * heavy + 0.5 * standard;
    const multiplier = card.modelAssumptions.githubModelTierMultiplier.standard;
    const included = seats * plans.business.includedAiCreditsPerUserPerMonth;
    const expected = Math.max(0, seats * perUser * multiplier - included);
    expect(near(line(model, 'github-copilot:overage').quantity)).toBe(near(expected));
  });

  it('pools the allowance across the billing entity rather than per user', () => {
    // 10 seats: one heavy user at 3,500 plus nine standard at 700 is 9,800
    // against a 19,000 pool, so nothing is billed even though the heavy user
    // individually exceeds 1,900. Ring-fencing would have billed 1,600.
    const { model } = volumeFor(['github-copilot'], {
      'github-copilot': { seats: 10, plan: 'business', heavyUserPct: 10, modelTier: 'standard' },
    });
    const perUser = 0.1 * heavy + 0.9 * standard;
    expect(perUser * 10).toBeLessThan(10 * plans.business.includedAiCreditsPerUserPerMonth);
    expect(heavy).toBeGreaterThan(plans.business.includedAiCreditsPerUserPerMonth);
    expect(line(model, 'github-copilot:overage').quantity).toBe(0);
  });

  it('produces zero overage when the allowance covers demand', () => {
    const { model } = volumeFor(['github-copilot'], {
      'github-copilot': { seats: 10, plan: 'enterprise', heavyUserPct: 0, modelTier: 'economy' },
    });
    expect(line(model, 'github-copilot:overage').quantity).toBe(0);
  });

  it('scales with the model tier multiplier', () => {
    const at = (modelTier: 'economy' | 'standard' | 'premium') =>
      line(
        volumeFor(['github-copilot'], {
          'github-copilot': { seats: 500, plan: 'business', heavyUserPct: 100, modelTier },
        }).model,
        'github-copilot:overage',
      ).quantity;
    expect(at('economy')).toBeLessThan(at('standard'));
    expect(at('standard')).toBeLessThan(at('premium'));
  });

  it('gives the enterprise plan a larger included allowance than business', () => {
    expect(plans.enterprise.includedAiCreditsPerUserPerMonth).toBeGreaterThan(
      plans.business.includedAiCreditsPerUserPerMonth,
    );
    const overageFor = (plan: 'business' | 'enterprise') =>
      line(
        volumeFor(['github-copilot'], {
          'github-copilot': { seats: 300, plan, heavyUserPct: 100, modelTier: 'premium' },
        }).model,
        'github-copilot:overage',
      ).quantity;
    expect(overageFor('enterprise')).toBeLessThan(overageFor('business'));
  });

  it('is internal but never licence-offsettable', () => {
    const { model } = volumeFor(['github-copilot'], {
      'github-copilot': { seats: 200, plan: 'business', heavyUserPct: 30, modelTier: 'standard' },
    });
    expect(line(model, 'github-copilot:overage').licensedShareOfInternal).toBe(0);
  });

  it('records the pre-allowance AI credit total for transparency', () => {
    const { trail } = volumeFor(['github-copilot'], {
      'github-copilot': { seats: 100, plan: 'business', heavyUserPct: 0, modelTier: 'standard' },
    });
    const entry = trail.entries.find((e) => e.step === 'volume:github-copilot:ai-credits');
    expect(entry?.output).toBeGreaterThan(0);
    expect(entry?.outputUnit).toBe('AI credits/month');
    // The most common misunderstanding: completions never draw credits.
    expect(entry?.inputs.codeCompletionsBilled).toBe(false);
  });
});

describe('model-level invariants', () => {
  it('produces no lines when nothing is selected', () => {
    const { model } = volumeFor([]);
    expect(model.lines).toEqual([]);
    expect(model.totalsByWorkload).toEqual({});
  });

  it('never emits a negative quantity', () => {
    const { model } = volumeFor(['github-copilot'], {
      'github-copilot': { seats: 1, plan: 'enterprise', heavyUserPct: 0, modelTier: 'economy' },
    });
    for (const l of model.lines) expect(l.quantity).toBeGreaterThanOrEqual(0);
  });

  it('totals by workload equal the sum of that workload lines', () => {
    const { model } = volumeFor(['copilot-studio-agents', 'm365-copilot-chat', 'voice-agents']);
    for (const [workloadId, total] of Object.entries(model.totalsByWorkload)) {
      const summed = model.lines
        .filter((l) => l.workloadId === workloadId)
        .reduce((a, l) => a + l.quantity, 0);
      expect(near(total)).toBe(near(summed));
    }
  });

  it('emits one audit entry per line with the full required shape', () => {
    const { model, trail } = volumeFor(['m365-copilot-chat']);
    for (const l of model.lines) {
      const entry = trail.entries.find((e) => e.step === `volume:${l.lineId}`);
      expect(entry, l.lineId).toBeDefined();
      expect(entry!.formula).toBeTruthy();
      expect(entry!.rateCardRef).toBe(`consumption.${l.rateId}`);
      expect(entry!.output).toBe(l.quantity);
      expect(Object.keys(entry!.inputs).length).toBeGreaterThan(0);
    }
  });

  it('handles every workload selected at once without throwing', () => {
    const all: WorkloadId[] = [
      'm365-copilot',
      'm365-copilot-chat',
      'copilot-studio-agents',
      'copilot-studio-flows',
      'sharepoint-agents',
      'voice-agents',
      'ai-tools',
      'd365-agents',
      'role-based-copilots',
      'security-copilot',
      'github-copilot',
      'copilot-cowork',
      'foundry-byom',
      'retrieval-api',
    ];
    const { model } = volumeFor(all);
    expect(model.lines.length).toBeGreaterThan(15);
    for (const l of model.lines) expect(Number.isFinite(l.quantity)).toBe(true);
  });
});
