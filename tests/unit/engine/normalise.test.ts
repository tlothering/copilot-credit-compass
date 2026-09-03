import { describe, expect, it } from 'vitest';
import {
  buildRampFactors,
  buildSeasonalityFactors,
  externalShareOf,
  normalise,
} from '@/lib/engine/normalise';
import { defaultAnswers } from '@/lib/schemas/answers';
import { answersWith, audit, near } from './fixtures';

describe('externalShareOf', () => {
  it.each([
    ['internal', 0, 0],
    ['internal', 90, 0],
    ['external', 0, 1],
    ['external', 40, 1],
    ['both', 40, 0.4],
    ['both', 0, 0],
    ['both', 100, 1],
    ['both', 150, 1],
    ['both', -10, 0],
  ] as const)('audience=%s pct=%d → %s', (audience, pct, expected) => {
    expect(externalShareOf(audience, pct)).toBe(expected);
  });
});

describe('buildRampFactors', () => {
  it('interpolates linearly between the month 1/3/6/12 anchors', () => {
    const a = defaultAnswers();
    a.growth = { ...a.growth, rampMonth1Pct: 20, rampMonth3Pct: 40, rampMonth6Pct: 70, rampMonth12Pct: 100 };
    const factors = buildRampFactors(a, audit());

    // Hand-calculated: m1 .20 | m2 = (.20+.40)/2 = .30 | m3 .40
    // m4 = .40 + (.70-.40)/3 = .50 | m5 = .40 + 2(.30)/3 = .60 | m6 .70
    // m7..m11 step (1.00-.70)/6 = .05 → .75 .80 .85 .90 .95 | m12 1.00
    expect(factors.map(near)).toEqual([
      0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1,
    ]);
  });

  it('produces a flat curve when every anchor is 100%', () => {
    const a = defaultAnswers();
    a.growth = { ...a.growth, rampMonth1Pct: 100, rampMonth3Pct: 100, rampMonth6Pct: 100, rampMonth12Pct: 100 };
    expect(buildRampFactors(a, audit())).toEqual(Array(12).fill(1));
  });

  it('handles a declining ramp without clamping', () => {
    const a = defaultAnswers();
    a.growth = { ...a.growth, rampMonth1Pct: 100, rampMonth3Pct: 80, rampMonth6Pct: 50, rampMonth12Pct: 20 };
    const f = buildRampFactors(a, audit());
    expect(f[0]).toBeCloseTo(1, 10);
    expect(f[11]).toBeCloseTo(0.2, 10);
    for (let i = 1; i < 12; i += 1) expect(f[i]!).toBeLessThanOrEqual(f[i - 1]!);
  });

  it('records exactly 12 factors and one audit entry', () => {
    const trail = audit();
    expect(buildRampFactors(defaultAnswers(), trail)).toHaveLength(12);
    expect(trail.entries).toHaveLength(1);
    expect(trail.entries[0]?.step).toBe('normalise:adoption-ramp');
  });
});

describe('buildSeasonalityFactors', () => {
  it.each(['flat', 'business-hours-peak'] as const)('%s is 1 in every month', (profile) => {
    expect(buildSeasonalityFactors(profile, 1.5, 11, audit())).toEqual(Array(12).fill(1));
  });

  it('applies the multiplier to the nominated peak month only', () => {
    const f = buildSeasonalityFactors('seasonal-spike', 1.8, 11, audit());
    expect(f).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.8, 1]);
  });

  it('applies the spike to month 1 and month 12 boundaries correctly', () => {
    expect(buildSeasonalityFactors('seasonal-spike', 2, 1, audit())[0]).toBe(2);
    expect(buildSeasonalityFactors('seasonal-spike', 2, 12, audit())[11]).toBe(2);
  });

  it('is a no-op when the peak month is out of the 1..12 range', () => {
    expect(buildSeasonalityFactors('seasonal-spike', 3, 99, audit())).toEqual(Array(12).fill(1));
  });
});

describe('normalise', () => {
  it('fills defaults for selected workloads the user skipped and flags them', () => {
    const a = defaultAnswers();
    a.workloads = ['m365-copilot-chat', 'voice-agents'];
    const n = normalise(a, audit());
    expect(n.activeWorkloads).toEqual(['m365-copilot-chat', 'voice-agents']);
    expect(n.defaultedWorkloads).toEqual(['m365-copilot-chat', 'voice-agents']);
    expect(n.answers.usage['m365-copilot-chat']?.users).toBe(1000);
    expect(n.answers.usage['voice-agents']?.callsPerDay).toBe(400);
  });

  it('does not flag workloads the user actually answered', () => {
    const a = answersWith(['m365-copilot-chat'], { 'm365-copilot-chat': { users: 42 } });
    const n = normalise(a, audit());
    expect(n.defaultedWorkloads).toEqual([]);
    expect(n.answers.usage['m365-copilot-chat']?.users).toBe(42);
  });

  it('never mutates the answers object it is given', () => {
    const a = defaultAnswers();
    a.workloads = ['m365-copilot-chat'];
    const snapshot = JSON.stringify(a);
    normalise(a, audit());
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it('reads seasonality from the Copilot Studio usage block', () => {
    const a = answersWith(['copilot-studio-agents'], {
      'copilot-studio-agents': { seasonality: 'seasonal-spike', peakMonthMultiplier: 2, peakMonth: 4 },
    });
    const n = normalise(a, audit());
    expect(n.seasonality).toBe('seasonal-spike');
    expect(n.peakMonthMultiplier).toBe(2);
    expect(n.peakMonth).toBe(4);
    expect(n.seasonalityFactors[3]).toBe(2);
  });

  it('falls back to flat/1/11 when Copilot Studio is not selected', () => {
    const n = normalise(answersWith(['m365-copilot-chat']), audit());
    expect(n.seasonality).toBe('flat');
    expect(n.peakMonthMultiplier).toBe(1);
    expect(n.peakMonth).toBe(11);
  });

  describe('internal population (max-overlap assumption)', () => {
    it('takes the largest single workload population, not the sum', () => {
      const a = answersWith(['m365-copilot-chat', 'd365-agents', 'role-based-copilots'], {
        'm365-copilot-chat': { users: 800 },
        'd365-agents': { users: 300 },
        'role-based-copilots': { users: 250 },
      });
      const n = normalise(a, audit());
      expect(n.internalUsers).toBe(800);
    });

    it('is bounded above by knowledge workers in scope', () => {
      const a = answersWith(
        ['m365-copilot-chat'],
        { 'm365-copilot-chat': { users: 5000 } },
        { profile: { knowledgeWorkers: 900 } },
      );
      expect(normalise(a, audit()).internalUsers).toBe(900);
    });

    it('falls back to the largest population when knowledge workers is zero', () => {
      const a = answersWith(
        ['m365-copilot-chat'],
        { 'm365-copilot-chat': { users: 640 } },
        { profile: { knowledgeWorkers: 0 } },
      );
      expect(normalise(a, audit()).internalUsers).toBe(640);
    });

    it('weights the licensed share by each workload population', () => {
      // 800 users @ 25% + 200 users @ 75% = (200 + 150) / 1000 = 0.35
      const a = answersWith(['m365-copilot-chat', 'copilot-cowork'], {
        'm365-copilot-chat': { users: 800, m365CopilotLicensedPct: 25 },
        'copilot-cowork': { users: 200, m365CopilotLicensedPct: 75 },
      });
      expect(near(normalise(a, audit()).internalLicensedShare)).toBe(0.35);
    });

    it('counts SharePoint agent reach as agentCount × usersPerAgent', () => {
      const a = answersWith(
        ['sharepoint-agents'],
        { 'sharepoint-agents': { agentCount: 5, usersPerAgent: 100 } },
        { profile: { knowledgeWorkers: 10_000 } },
      );
      expect(normalise(a, audit()).internalUsers).toBe(500);
    });

    it('excludes a fully external Copilot Studio audience from the internal population', () => {
      const a = answersWith(['copilot-studio-agents'], {
        'copilot-studio-agents': { audience: 'external', externalTrafficPct: 100, internalUsers: 900 },
      });
      expect(normalise(a, audit()).internalUsers).toBe(0);
    });

    it('keeps the internal population for a mixed audience', () => {
      const a = answersWith(['copilot-studio-agents'], {
        'copilot-studio-agents': { audience: 'both', externalTrafficPct: 50, internalUsers: 900 },
      });
      expect(normalise(a, audit()).internalUsers).toBe(900);
    });

    it('returns zero users and zero licensed share when no user-bearing workload is selected', () => {
      const n = normalise(answersWith(['retrieval-api']), audit());
      expect(n.internalUsers).toBe(0);
      expect(n.internalLicensedShare).toBe(0);
    });
  });

  it('carries the declared confidence through unchanged', () => {
    for (const confidence of ['low', 'medium', 'high'] as const) {
      const a = answersWith(['m365-copilot-chat'], {}, { growth: { confidence } });
      expect(normalise(a, audit()).confidence).toBe(confidence);
    }
  });
});
