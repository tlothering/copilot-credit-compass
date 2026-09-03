import type { Answers } from '@/lib/schemas/answers';
import { WORKLOAD_DEFAULTS, defaultAnswers } from '@/lib/schemas/answers';
import type { WorkloadId } from '@/lib/schemas/taxonomy';
import { createAuditTrail } from '@/lib/engine/util';
import { getRateCard } from '@/lib/engine/rate-card';

export const card = getRateCard();
export const audit = () => createAuditTrail();

type Usage = Answers['usage'];

/**
 * Builds a valid Answers object with exactly the workloads asked for, seeded from the
 * shipped defaults and then overridden field-by-field. Keeping this in one place means
 * a schema change breaks the fixture rather than forty individual tests.
 */
export function answersWith(
  workloads: WorkloadId[],
  usageOverrides: Partial<Record<WorkloadId, Record<string, unknown>>> = {},
  patch: Partial<{
    profile: Partial<Answers['profile']>;
    growth: Partial<Answers['growth']>;
    consent: Partial<Answers['consent']>;
  }> = {},
): Answers {
  const base = defaultAnswers();
  const usage: Record<string, unknown> = {};
  for (const id of workloads) {
    const defaults = WORKLOAD_DEFAULTS[id as keyof typeof WORKLOAD_DEFAULTS];
    usage[id] = { ...(defaults as object), ...(usageOverrides[id] ?? {}) };
  }
  return {
    ...base,
    profile: { ...base.profile, ...patch.profile },
    workloads,
    usage: usage as Usage,
    growth: { ...base.growth, ...patch.growth },
    consent: { ...base.consent, ...patch.consent },
  };
}

/** A no-ramp, no-seasonality org so steady-state maths is directly observable. */
export const FLAT_GROWTH = {
  rampMonth1Pct: 100,
  rampMonth3Pct: 100,
  rampMonth6Pct: 100,
  rampMonth12Pct: 100,
} as const;

export function flatAnswers(
  workloads: WorkloadId[],
  usageOverrides: Partial<Record<WorkloadId, Record<string, unknown>>> = {},
  patch: Parameters<typeof answersWith>[2] = {},
): Answers {
  return answersWith(workloads, usageOverrides, {
    ...patch,
    growth: { ...FLAT_GROWTH, ...patch.growth },
  });
}

/** Rounds to 6 dp so float noise never fails an otherwise-correct assertion. */
export const near = (value: number) => Math.round(value * 1e6) / 1e6;
