import { z } from 'zod';
import {
  EMPLOYEE_BANDS,
  INDUSTRIES,
  KNOWLEDGE_WORKER_BANDS,
  REGIONS,
  WORKLOAD_IDS,
  bandFromCount,
} from '@/lib/schemas/taxonomy';
import type { Answers } from '@/lib/schemas/answers';
import type { EngineResult } from '@/lib/engine/types';

/**
 * The complete set of fields that may ever leave the browser (constraint C1).
 * Everything here is banded, rounded or enumerated. There is no free text and
 * no field from which an organisation could be identified.
 */
export const benchmarkRecordSchema = z.object({
  rateCardVersion: z.string().max(32),
  industry: z.enum(INDUSTRIES),
  region: z.enum(REGIONS),
  employeeBand: z.enum(EMPLOYEE_BANDS),
  knowledgeWorkerBand: z.enum(KNOWLEDGE_WORKER_BANDS),
  workloads: z.array(z.enum(WORKLOAD_IDS)).max(WORKLOAD_IDS.length),
  agentCount: z.number().int().min(0).max(100_000),
  monthlyCreditsExpected: z.number().min(0),
  monthlyCostExpectedUsd: z.number().min(0),
  creditsPerKnowledgeWorkerPerMonth: z.number().min(0),
  m365CopilotLicensedSharePct: z.number().min(0).max(100),
  mixClassicPct: z.number().min(0).max(100),
  mixGenerativePct: z.number().min(0).max(100),
  mixActionPct: z.number().min(0).max(100),
  graphGroundingPct: z.number().min(0).max(100),
  recommendedStrategy: z.string().max(64),
  estimatedAnnualSavingVsPaygUsd: z.number(),
});

export type BenchmarkRecord = z.infer<typeof benchmarkRecordSchema>;

/** The stored document adds only server-generated, non-identifying fields. */
export const storedRecordSchema = benchmarkRecordSchema.extend({
  id: z.string().uuid(),
  submittedAt: z.string(),
  /** Cosmos partition key — the coarse cohort, never anything user-specific. */
  cohort: z.string(),
});

export type StoredRecord = z.infer<typeof storedRecordSchema>;

export function cohortKey(r: Pick<BenchmarkRecord, 'industry' | 'region' | 'employeeBand'>): string {
  return `${r.industry}|${r.region}|${r.employeeBand}`;
}

/** Rounds to a sensible number of significant figures so values cannot fingerprint a run. */
function bucket(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / step) * step;
}

function creditBucket(value: number): number {
  if (value < 1_000) return bucket(value, 50);
  if (value < 100_000) return bucket(value, 500);
  if (value < 1_000_000) return bucket(value, 5_000);
  return bucket(value, 50_000);
}

function moneyBucket(value: number): number {
  if (Math.abs(value) < 1_000) return bucket(value, 25);
  if (Math.abs(value) < 100_000) return bucket(value, 250);
  return bucket(value, 2_500);
}

/**
 * Derives the anonymous record from a completed run. Deliberately reads only
 * from the engine result and the banded profile — never from raw usage input.
 */
export function buildBenchmarkRecord(answers: Answers, result: EngineResult): BenchmarkRecord {
  const studio = answers.usage['copilot-studio-agents'];
  const sharepoint = answers.usage['sharepoint-agents'];
  const agentCount = (studio?.agents12m ?? 0) + (sharepoint?.agentCount ?? 0);

  const kw = Math.max(1, answers.profile.knowledgeWorkers);
  const monthlyCredits = result.credits.billableCredits;
  const perWorker = monthlyCredits / kw;

  const be = result.licenceBreakEven;
  const licensedSharePct =
    be.internalUsers > 0 ? (be.licensedInternalUsers / be.internalUsers) * 100 : 0;

  const payg = result.fundingOptions.find((o) => o.id === 'payg');
  const saving = payg
    ? payg.twelveMonthTotalUsd - result.recommendation.primary.twelveMonthTotalUsd
    : result.recommendation.annualSavingVsNaivePaygUsd;

  return benchmarkRecordSchema.parse({
    rateCardVersion: result.rateCardVersion,
    industry: answers.profile.industry,
    region: answers.profile.region,
    employeeBand: answers.profile.employeeBand,
    knowledgeWorkerBand: bandFromCount(answers.profile.knowledgeWorkers),
    workloads: [...answers.workloads],
    agentCount: Math.round(agentCount),
    monthlyCreditsExpected: creditBucket(monthlyCredits),
    monthlyCostExpectedUsd: moneyBucket(result.cost.meteredCreditCostUsd),
    creditsPerKnowledgeWorkerPerMonth: Math.round(perWorker),
    m365CopilotLicensedSharePct: Math.round(Math.min(100, licensedSharePct)),
    mixClassicPct: Math.round(studio?.mixClassicPct ?? 0),
    mixGenerativePct: Math.round(studio?.mixGenerativePct ?? 0),
    mixActionPct: Math.round(studio?.mixActionPct ?? 0),
    graphGroundingPct: Math.round(studio?.graphGroundingPct ?? 0),
    recommendedStrategy: result.recommendation.primary.optionId,
    estimatedAnnualSavingVsPaygUsd: moneyBucket(saving),
  });
}
