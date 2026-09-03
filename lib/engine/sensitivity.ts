import type { Answers } from '@/lib/schemas/answers';
import type { RateCard, SensitivityItem } from './types';

/** A single numeric answer field that the tornado chart may perturb. */
export interface PerturbableInput {
  id: string;
  label: string;
  value: number;
  /** Percentage-style fields are clamped to 0..100 after perturbation. */
  isPercentage: boolean;
  set: (answers: Answers, value: number) => void;
}

/** Fields that are structural rather than volumetric — perturbing them is meaningless. */
const EXCLUDED_LEAVES = new Set([
  'peakMonth',
  'rampMonth1Pct',
  'rampMonth3Pct',
  'rampMonth6Pct',
  'rampMonth12Pct',
]);

const LABEL_OVERRIDES: Record<string, string> = {
  knowledgeWorkers: 'Knowledge workers in scope',
  externalTrafficPct: 'Share of traffic that is external',
  m365CopilotLicensedPct: 'Share of users holding an M365 Copilot licence',
  peakMonthMultiplier: 'Seasonal peak multiplier',
};

/** Words that must keep their casing when a field name is turned into a label. */
const ACRONYMS = new Set(['AI', 'SCU', 'API', 'BU', 'M365', 'PTU', 'AHT']);

function humanise(path: string[]): string {
  const leaf = path[path.length - 1] ?? '';
  const override = LABEL_OVERRIDES[leaf];
  const readable =
    override ??
    leaf
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\bPct\b/g, '%')
      .replace(/\b12m\b/g, 'at month 12')
      .trim()
      .split(/\s+/)
      .map((word) => (ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word.toLowerCase()))
      .join(' ');
  const scope = path.length > 2 ? `${path[1]}: ` : '';
  return `${scope}${readable.charAt(0).toUpperCase()}${readable.slice(1)}`;
}

function setAtPath(target: Record<string, unknown>, path: string[], value: number): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (key === undefined) return;
    const next = cursor[key];
    if (typeof next !== 'object' || next === null) return;
    cursor = next as Record<string, unknown>;
  }
  const leaf = path[path.length - 1];
  if (leaf !== undefined) cursor[leaf] = value;
}

/** Walks the answer tree and collects every numeric leaf that is worth perturbing. */
export function collectPerturbableInputs(answers: Answers): PerturbableInput[] {
  const inputs: PerturbableInput[] = [];

  const walk = (node: unknown, path: string[]): void => {
    if (typeof node === 'number') {
      const leaf = path[path.length - 1] ?? '';
      if (EXCLUDED_LEAVES.has(leaf) || node === 0) return;
      inputs.push({
        id: path.join('.'),
        label: humanise(path),
        value: node,
        isPercentage: leaf.endsWith('Pct'),
        set: (target, value) => setAtPath(target as unknown as Record<string, unknown>, path, value),
      });
      return;
    }
    if (Array.isArray(node) || typeof node !== 'object' || node === null) return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, [...path, key]);
    }
  };

  walk(answers.usage, ['usage']);
  walk(answers.profile.knowledgeWorkers, ['profile', 'knowledgeWorkers']);

  return inputs;
}

/**
 * SPEC §7 — the tornado chart. Each candidate input is moved ±20% and the whole pipeline
 * is re-run, so the swing shown is the true modelled swing rather than a local derivative.
 */
export function buildSensitivity(
  answers: Answers,
  card: RateCard,
  baselineTotalUsd: number,
  evaluate: (answers: Answers) => number,
): SensitivityItem[] {
  const delta = card.modelAssumptions.sensitivityPerturbationPct / 100;
  const items: SensitivityItem[] = [];

  for (const input of collectPerturbableInputs(answers)) {
    const lowValue = input.isPercentage
      ? Math.max(0, Math.min(100, input.value * (1 - delta)))
      : input.value * (1 - delta);
    const highValue = input.isPercentage
      ? Math.max(0, Math.min(100, input.value * (1 + delta)))
      : input.value * (1 + delta);

    const lowAnswers = structuredClone(answers);
    input.set(lowAnswers, lowValue);
    const highAnswers = structuredClone(answers);
    input.set(highAnswers, highValue);

    const lowTotalUsd = evaluate(lowAnswers);
    const highTotalUsd = evaluate(highAnswers);
    const swingUsd = Math.abs(highTotalUsd - lowTotalUsd);

    if (swingUsd === 0) continue;

    items.push({
      inputId: input.id,
      label: input.label,
      baselineValue: input.value,
      lowValue,
      highValue,
      lowTotalUsd,
      highTotalUsd,
      baselineTotalUsd,
      swingUsd,
      swingPct: baselineTotalUsd === 0 ? 0 : (swingUsd / baselineTotalUsd) * 100,
    });
  }

  return items.sort((a, b) => b.swingUsd - a.swingUsd || a.inputId.localeCompare(b.inputId)).slice(0, 5);
}
