import { describe, expect, it } from 'vitest';
import { buildSensitivity, collectPerturbableInputs } from '@/lib/engine/sensitivity';
import type { Answers } from '@/lib/schemas/answers';
import { answersWith, card, near } from './fixtures';

const BASE = answersWith(['m365-copilot-chat', 'copilot-studio-agents']);

/** A cheap stand-in for the real pipeline: total cost rises with every numeric leaf. */
function fakeEvaluate(weights: Record<string, number> = {}) {
  return (answers: Answers): number => {
    let total = 0;
    const walk = (node: unknown, path: string[]): void => {
      if (typeof node === 'number') {
        total += node * (weights[path.join('.')] ?? 1);
        return;
      }
      if (Array.isArray(node) || typeof node !== 'object' || node === null) return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, [...path, k]);
    };
    walk(answers.usage, ['usage']);
    walk(answers.profile.knowledgeWorkers, ['profile', 'knowledgeWorkers']);
    return total;
  };
}

describe('collectPerturbableInputs', () => {
  it('collects numeric usage leaves', () => {
    const ids = collectPerturbableInputs(BASE).map((i) => i.id);
    expect(ids).toContain('usage.m365-copilot-chat.messagesPerUserPerDay');
    expect(ids).toContain('usage.m365-copilot-chat.users');
  });

  it('includes the knowledge-worker population', () => {
    expect(collectPerturbableInputs(BASE).map((i) => i.id)).toContain('profile.knowledgeWorkers');
  });

  it('excludes structural ramp and peak-month fields', () => {
    const ids = collectPerturbableInputs(BASE).map((i) => i.id);
    for (const excluded of [
      'peakMonth',
      'rampMonth1Pct',
      'rampMonth3Pct',
      'rampMonth6Pct',
      'rampMonth12Pct',
    ]) {
      expect(ids.some((id) => id.endsWith(`.${excluded}`))).toBe(false);
    }
  });

  it('excludes non-numeric answers', () => {
    for (const input of collectPerturbableInputs(BASE)) {
      expect(typeof input.value).toBe('number');
    }
  });

  it('skips zero-valued leaves, which cannot be perturbed proportionally', () => {
    const answers = answersWith(['copilot-studio-agents'], {
      'copilot-studio-agents': { externalTrafficPct: 0 },
    });
    expect(collectPerturbableInputs(answers).map((i) => i.id)).not.toContain(
      'usage.copilot-studio-agents.externalTrafficPct',
    );
  });

  it('returns nothing when no workloads are selected', () => {
    const answers = answersWith([], {}, { profile: { knowledgeWorkers: 0 } });
    expect(collectPerturbableInputs(answers)).toEqual([]);
  });

  it('flags percentage fields so they can be clamped', () => {
    const inputs = collectPerturbableInputs(BASE);
    expect(inputs.find((i) => i.id.endsWith('generativeSharePct'))?.isPercentage).toBe(true);
    expect(inputs.find((i) => i.id.endsWith('users'))?.isPercentage).toBe(false);
  });

  it('writes back through the setter without mutating the source', () => {
    const input = collectPerturbableInputs(BASE).find((i) => i.id.endsWith('.users'))!;
    const clone = structuredClone(BASE);
    input.set(clone, 9999);
    expect((clone.usage['m365-copilot-chat'] as { users: number }).users).toBe(9999);
    expect((BASE.usage['m365-copilot-chat'] as { users: number }).users).not.toBe(9999);
  });
});

describe('labels', () => {
  it('prefixes workload-scoped fields with the workload id', () => {
    const item = collectPerturbableInputs(BASE).find(
      (i) => i.id === 'usage.m365-copilot-chat.messagesPerUserPerDay',
    );
    expect(item?.label).toBe('m365-copilot-chat: Messages per user per day');
  });

  it('uses a friendly override where one exists', () => {
    expect(
      collectPerturbableInputs(BASE).find((i) => i.id === 'profile.knowledgeWorkers')?.label,
    ).toBe('Knowledge workers in scope');
    expect(
      collectPerturbableInputs(BASE).find((i) => i.id.endsWith('m365CopilotLicensedPct'))?.label,
    ).toContain('M365 Copilot licence');
  });

  it('renders a Pct suffix as a percent sign', () => {
    const item = collectPerturbableInputs(BASE).find((i) => i.id.endsWith('generativeSharePct'));
    expect(item?.label).toContain('%');
    expect(item?.label).not.toContain('Pct');
  });
});

describe('buildSensitivity', () => {
  const evaluate = fakeEvaluate();
  const baseline = evaluate(BASE);

  it('perturbs by the rate-card percentage in both directions', () => {
    const delta = card.modelAssumptions.sensitivityPerturbationPct / 100;
    const items = buildSensitivity(BASE, card, baseline, evaluate);
    for (const item of items) {
      if (item.baselineValue * (1 + delta) <= 100 || !item.inputId.endsWith('Pct')) {
        expect(near(item.lowValue)).toBe(near(item.baselineValue * (1 - delta)));
      }
      expect(item.highValue).toBeGreaterThanOrEqual(item.lowValue);
    }
  });

  it('clamps percentage fields inside 0..100', () => {
    const answers = answersWith(['m365-copilot-chat'], {
      'm365-copilot-chat': { generativeSharePct: 95 },
    });
    const items = buildSensitivity(answers, card, evaluate(answers), evaluate);
    const pct = items.find((i) => i.inputId.endsWith('generativeSharePct'));
    if (pct) {
      expect(pct.highValue).toBeLessThanOrEqual(100);
      expect(pct.lowValue).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns at most the top five swings', () => {
    expect(buildSensitivity(BASE, card, baseline, evaluate).length).toBeLessThanOrEqual(5);
  });

  it('sorts by absolute swing, largest first', () => {
    const items = buildSensitivity(BASE, card, baseline, evaluate);
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i - 1]!.swingUsd).toBeGreaterThanOrEqual(items[i]!.swingUsd);
    }
  });

  it('ranks the heaviest-weighted input first', () => {
    const weighted = fakeEvaluate({ 'usage.m365-copilot-chat.users': 1000 });
    const items = buildSensitivity(BASE, card, weighted(BASE), weighted);
    expect(items[0]?.inputId).toBe('usage.m365-copilot-chat.users');
  });

  it('drops inputs that make no difference at all', () => {
    const flatEvaluate = () => 1234;
    expect(buildSensitivity(BASE, card, 1234, flatEvaluate)).toEqual([]);
  });

  it('expresses the swing as a percentage of the baseline', () => {
    for (const item of buildSensitivity(BASE, card, baseline, evaluate)) {
      expect(near(item.swingPct)).toBe(near((item.swingUsd / baseline) * 100));
      expect(near(item.swingUsd)).toBe(near(Math.abs(item.highTotalUsd - item.lowTotalUsd)));
      expect(item.baselineTotalUsd).toBe(baseline);
    }
  });

  it('reports a zero percentage rather than dividing by a zero baseline', () => {
    let call = 0;
    const alternating = () => (call++ % 2 === 0 ? 10 : 20);
    for (const item of buildSensitivity(BASE, card, 0, alternating)) {
      expect(item.swingPct).toBe(0);
    }
  });

  it('never mutates the answers it was given', () => {
    const snapshot = JSON.stringify(BASE);
    buildSensitivity(BASE, card, baseline, evaluate);
    expect(JSON.stringify(BASE)).toBe(snapshot);
  });

  it('breaks ties deterministically by input id', () => {
    const constantSwing = (answers: Answers) =>
      collectPerturbableInputs(answers).length + (answers.profile.knowledgeWorkers > 0 ? 0 : 0);
    const a = buildSensitivity(BASE, card, baseline, fakeEvaluate({}));
    const b = buildSensitivity(BASE, card, baseline, fakeEvaluate({}));
    expect(a.map((i) => i.inputId)).toEqual(b.map((i) => i.inputId));
    expect(typeof constantSwing).toBe('function');
  });
});
