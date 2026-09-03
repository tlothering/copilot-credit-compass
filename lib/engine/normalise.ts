import { WORKLOAD_DEFAULTS, type Answers } from '@/lib/schemas/answers';
import type { SeasonalityProfile, WorkloadId } from '@/lib/schemas/taxonomy';
import type { AuditTrail } from './util';
import { clamp, lerp, safeDiv } from './util';
import type { NormalisedAnswers } from './types';

/**
 * Fills in industry defaults for any selected workload the user skipped, derives the
 * seasonality and adoption-ramp curves, and resolves the internal-user population that
 * the Microsoft 365 Copilot licence offset is calculated against.
 *
 * Pure: it never mutates the answers it is given.
 */
export function normalise(answers: Answers, audit: AuditTrail): NormalisedAnswers {
  const activeWorkloads: WorkloadId[] = [];
  const defaultedWorkloads: WorkloadId[] = [];
  const usage: Record<string, unknown> = { ...answers.usage };

  for (const id of answers.workloads) {
    const existing = usage[id];
    if (existing === undefined || existing === null) {
      usage[id] = structuredClone(WORKLOAD_DEFAULTS[id]);
      defaultedWorkloads.push(id);
    }
    activeWorkloads.push(id);
  }

  const filled: Answers = {
    ...answers,
    usage: usage as Answers['usage'],
  };

  const studio = filled.usage['copilot-studio-agents'];
  const seasonality: SeasonalityProfile = studio?.seasonality ?? 'flat';
  const peakMonthMultiplier = studio?.peakMonthMultiplier ?? 1;
  const peakMonth = studio?.peakMonth ?? 11;

  const { internalUsers, internalLicensedShare } = resolveInternalPopulation(filled, audit);
  const rampFactors = buildRampFactors(filled, audit);
  const seasonalityFactors = buildSeasonalityFactors(
    seasonality,
    peakMonthMultiplier,
    peakMonth,
    audit,
  );

  return {
    answers: filled,
    activeWorkloads,
    defaultedWorkloads,
    seasonality,
    peakMonthMultiplier,
    peakMonth,
    internalUsers,
    internalLicensedShare,
    rampFactors,
    seasonalityFactors,
    confidence: filled.growth.confidence,
  };
}

interface UserPopulation {
  workloadId: WorkloadId;
  users: number;
  licensedShare: number;
}

/**
 * Workload user populations overlap heavily — the same employee uses the HR agent, the
 * IT agent and Copilot Chat. Counting them per workload would massively overstate the
 * seat count needed for a licence shift, so we take the largest single internal
 * population (the "max-overlap assumption") bounded by knowledge workers in scope, and
 * weight the licensed share by each workload's stated population.
 */
function resolveInternalPopulation(
  answers: Answers,
  audit: AuditTrail,
): { internalUsers: number; internalLicensedShare: number } {
  const populations: UserPopulation[] = [];
  const u = answers.usage;

  if (u['copilot-studio-agents']) {
    const a = u['copilot-studio-agents'];
    const externalShare = externalShareOf(a.audience, a.externalTrafficPct);
    populations.push({
      workloadId: 'copilot-studio-agents',
      users: a.internalUsers * (externalShare < 1 ? 1 : 0),
      licensedShare: a.m365CopilotLicensedPct / 100,
    });
  }
  if (u['m365-copilot-chat']) {
    populations.push({
      workloadId: 'm365-copilot-chat',
      users: u['m365-copilot-chat'].users,
      licensedShare: u['m365-copilot-chat'].m365CopilotLicensedPct / 100,
    });
  }
  if (u['sharepoint-agents']) {
    const s = u['sharepoint-agents'];
    populations.push({
      workloadId: 'sharepoint-agents',
      users: s.agentCount * s.usersPerAgent,
      licensedShare: s.m365CopilotLicensedPct / 100,
    });
  }
  if (u['d365-agents']) {
    populations.push({
      workloadId: 'd365-agents',
      users: u['d365-agents'].users,
      licensedShare: u['d365-agents'].m365CopilotLicensedPct / 100,
    });
  }
  if (u['role-based-copilots']) {
    populations.push({
      workloadId: 'role-based-copilots',
      users: u['role-based-copilots'].users,
      licensedShare: u['role-based-copilots'].m365CopilotLicensedPct / 100,
    });
  }
  if (u['copilot-cowork']) {
    populations.push({
      workloadId: 'copilot-cowork',
      users: u['copilot-cowork'].users,
      licensedShare: u['copilot-cowork'].m365CopilotLicensedPct / 100,
    });
  }

  const largest = populations.reduce((acc, p) => Math.max(acc, p.users), 0);
  const knowledgeWorkers = answers.profile.knowledgeWorkers;
  const internalUsers = knowledgeWorkers > 0 ? Math.min(largest, knowledgeWorkers) : largest;

  const totalUsers = populations.reduce((acc, p) => acc + p.users, 0);
  const weightedLicensed = populations.reduce((acc, p) => acc + p.users * p.licensedShare, 0);
  const internalLicensedShare = clamp(safeDiv(weightedLicensed, totalUsers), 0, 1);

  audit.record(
    'normalise:internal-population',
    'internalUsers = min(max(workload internal populations), knowledgeWorkers); licensedShare = Σ(users × licensedPct) ÷ Σ(users)',
    {
      largestWorkloadPopulation: largest,
      knowledgeWorkers,
      populationsConsidered: populations.length,
      weightedLicensedUsers: Math.round(weightedLicensed),
    },
    internalUsers,
    'users',
  );
  audit.record(
    'normalise:internal-licensed-share',
    'internalLicensedShare = Σ(users × licensedPct) ÷ Σ(users)',
    { totalUsersAcrossWorkloads: totalUsers, weightedLicensedUsers: Math.round(weightedLicensed) },
    internalLicensedShare,
    'share',
  );

  return { internalUsers, internalLicensedShare };
}

export function externalShareOf(
  audience: 'internal' | 'external' | 'both',
  externalTrafficPct: number,
): number {
  if (audience === 'internal') return 0;
  if (audience === 'external') return 1;
  return clamp(externalTrafficPct / 100, 0, 1);
}

/**
 * The user gives adoption anchors at months 1, 3, 6 and 12. We linearly interpolate the
 * months in between; nothing is extrapolated beyond month 12.
 */
export function buildRampFactors(answers: Answers, audit: AuditTrail): number[] {
  const g = answers.growth;
  const r1 = g.rampMonth1Pct / 100;
  const r3 = g.rampMonth3Pct / 100;
  const r6 = g.rampMonth6Pct / 100;
  const r12 = g.rampMonth12Pct / 100;

  const factors: number[] = [
    r1,
    lerp(r1, r3, 1 / 2),
    r3,
    lerp(r3, r6, 1 / 3),
    lerp(r3, r6, 2 / 3),
    r6,
    lerp(r6, r12, 1 / 6),
    lerp(r6, r12, 2 / 6),
    lerp(r6, r12, 3 / 6),
    lerp(r6, r12, 4 / 6),
    lerp(r6, r12, 5 / 6),
    r12,
  ];

  audit.record(
    'normalise:adoption-ramp',
    'Linear interpolation between the month 1/3/6/12 adoption anchors',
    {
      month1Pct: g.rampMonth1Pct,
      month3Pct: g.rampMonth3Pct,
      month6Pct: g.rampMonth6Pct,
      month12Pct: g.rampMonth12Pct,
    },
    factors.reduce((a, b) => a + b, 0) / 12,
    'mean ramp factor',
  );

  return factors;
}

/**
 * Seasonality shapes the month-by-month curve.
 * - flat: every month equal.
 * - business-hours-peak: concurrency is peaky within a day but monthly totals are flat,
 *   so the monthly factors stay at 1 (business days already capture the working pattern).
 * - seasonal-spike: the nominated peak month carries the stated multiplier.
 */
export function buildSeasonalityFactors(
  profile: SeasonalityProfile,
  peakMultiplier: number,
  peakMonth: number,
  audit: AuditTrail,
): number[] {
  const factors = Array.from({ length: 12 }, (_, i) => {
    if (profile !== 'seasonal-spike') return 1;
    return i + 1 === peakMonth ? peakMultiplier : 1;
  });

  audit.record(
    'normalise:seasonality',
    profile === 'seasonal-spike'
      ? 'Peak month multiplied by peakMonthMultiplier; all other months × 1'
      : 'All months × 1 (intra-day concentration does not change monthly volume)',
    { profile, peakMultiplier, peakMonth },
    factors.reduce((a, b) => a + b, 0),
    'sum of 12 monthly factors',
  );

  return factors;
}
