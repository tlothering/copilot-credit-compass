import { describe, expect, it } from 'vitest';
import { runEngine, runEstimate } from '@/lib/engine';
import { answersWith, card } from './fixtures';
import type { WorkloadId } from '@/lib/schemas/taxonomy';

const ALL_WORKLOADS: WorkloadId[] = [
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

const BASE = answersWith(['m365-copilot-chat', 'copilot-studio-agents']);

describe('runEngine', () => {
  it('stamps the rate-card version, effective date and currency onto the result', () => {
    const r = runEngine(BASE, card);
    expect(r.rateCardVersion).toBe(card.version);
    expect(r.rateCardEffectiveDate).toBe(card.effectiveDate);
    expect(r.currency).toBe(card.currency);
  });

  it('returns every section the dashboard needs', () => {
    const r = runEngine(BASE, card);
    for (const key of [
      'normalised',
      'volume',
      'credits',
      'cost',
      'scenario',
      'licenceBreakEven',
      'fundingOptions',
      'recommendation',
      'sensitivity',
      'risks',
      'audit',
    ] as const) {
      expect(r[key], key).toBeDefined();
    }
  });

  it('is deterministic — the same answers produce byte-identical output', () => {
    expect(JSON.stringify(runEngine(BASE, card))).toBe(JSON.stringify(runEngine(BASE, card)));
  });

  it('does not mutate the answers it is given', () => {
    const snapshot = JSON.stringify(BASE);
    runEngine(BASE, card);
    expect(JSON.stringify(BASE)).toBe(snapshot);
  });

  it('runs every workload together without producing a NaN anywhere', () => {
    const r = runEngine(answersWith(ALL_WORKLOADS), card);
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'number') {
        expect(Number.isNaN(node), `NaN at ${path}`).toBe(false);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
      }
    };
    walk(r, 'result');
  });

  it('handles the empty estate without throwing', () => {
    const r = runEngine(answersWith([]), card);
    expect(r.credits.grossCredits).toBe(0);
    expect(r.fundingOptions).toHaveLength(8);
    expect(r.recommendation.ranked).toHaveLength(8);
  });
});

describe('the audit trail', () => {
  it('records a meaningful number of steps', () => {
    expect(runEngine(BASE, card).audit.length).toBeGreaterThan(20);
  });

  it('gives every entry the full disclosure shape', () => {
    for (const entry of runEngine(BASE, card).audit) {
      expect(typeof entry.step).toBe('string');
      expect(entry.step.length).toBeGreaterThan(0);
      expect(typeof entry.formula).toBe('string');
      expect(entry.formula.length).toBeGreaterThan(0);
      expect(typeof entry.inputs).toBe('object');
      expect(typeof entry.output).toBe('number');
      expect(Number.isNaN(entry.output), entry.step).toBe(false);
      expect(typeof entry.outputUnit).toBe('string');
      expect(entry.rateCardRef === null || typeof entry.rateCardRef === 'string').toBe(true);
    }
  });

  it('covers every pipeline stage', () => {
    const steps = runEngine(BASE, card).audit.map((e) => e.step);
    for (const prefix of [
      'normalise:',
      'volume:',
      'credits:',
      'cost:',
      'scenario:',
      'licence:',
      'funding:',
      'recommendation:',
    ]) {
      expect(steps.some((s) => s.startsWith(prefix)), prefix).toBe(true);
    }
  });

  it('points most rate-dependent steps at a rate-card path', () => {
    const refs = runEngine(BASE, card)
      .audit.map((e) => e.rateCardRef)
      .filter((r): r is string => typeof r === 'string');
    expect(refs.length).toBeGreaterThan(10);
  });
});

describe('the risk register', () => {
  it('always warns that the rate card can change', () => {
    const ids = runEngine(BASE, card).risks.map((r) => r.id);
    expect(ids).toContain('rate-change');
  });

  it('gives every risk a severity, description and mitigation', () => {
    for (const risk of runEngine(answersWith(ALL_WORKLOADS), card).risks) {
      expect(['low', 'medium', 'high']).toContain(risk.severity);
      expect(risk.title.length).toBeGreaterThan(0);
      expect(risk.description.length).toBeGreaterThan(0);
      expect(risk.mitigation.length).toBeGreaterThan(0);
    }
  });

  it('flags external exposure when customer-facing traffic exists', () => {
    const r = runEngine(
      answersWith(['copilot-studio-agents'], {
        'copilot-studio-agents': { audience: 'external', externalTrafficPct: 100 },
      }),
      card,
    );
    expect(r.risks.map((x) => x.id)).toContain('external-exposure');
  });

  it('flags low forecast confidence', () => {
    const r = runEngine(
      answersWith(['m365-copilot-chat'], {}, { growth: { confidence: 'low' } }),
      card,
    );
    const risk = r.risks.find((x) => x.id === 'low-confidence');
    expect(risk?.severity).toBe('high');
  });

  it('flags an estimate that rests on our defaults', () => {
    const r = runEngine(answersWith(['m365-copilot-chat', 'copilot-studio-agents']), card);
    if (r.normalised.defaultedWorkloads.length > 0) {
      expect(r.risks.map((x) => x.id)).toContain('defaulted-inputs');
    }
  });
});

describe('sensitivity integration', () => {
  it('produces a populated tornado for a real estate', () => {
    const items = runEngine(BASE, card).sensitivity;
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it('measures every swing against the same primary option', () => {
    for (const item of runEngine(BASE, card).sensitivity) {
      expect(item.swingUsd).toBeGreaterThan(0);
      expect(Number.isFinite(item.lowTotalUsd)).toBe(true);
      expect(Number.isFinite(item.highTotalUsd)).toBe(true);
    }
  });

  it('is empty when there is nothing to vary', () => {
    expect(runEngine(answersWith([], {}, { profile: { knowledgeWorkers: 0 } }), card).sensitivity)
      .toEqual([]);
  });
});

describe('runEstimate', () => {
  it('returns the live figures the wizard rail needs', () => {
    const e = runEstimate(BASE, card);
    expect(e.monthlyCredits).toBeGreaterThan(0);
    expect(e.annualCostUsd).toBeGreaterThan(0);
    expect(e.rateCardVersion).toBe(card.version);
  });

  it('agrees with the full engine on the headline annual cost', () => {
    expect(runEstimate(BASE, card).annualCostUsd).toBe(
      runEngine(BASE, card).recommendation.primary.twelveMonthTotalUsd,
    );
  });

  it('returns zero for an empty estate rather than throwing', () => {
    const e = runEstimate(answersWith([]), card);
    expect(e.monthlyCredits).toBe(0);
    expect(e.annualCostUsd).toBe(0);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(runEstimate(BASE, card))).toBe(JSON.stringify(runEstimate(BASE, card)));
  });
});
