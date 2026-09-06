import { z } from 'zod';
import {
  AI_TOOL_TIERS,
  AUDIENCES,
  AZURE_AGREEMENTS,
  BUDGET_TOLERANCES,
  CONFIDENCE_LEVELS,
  EMPLOYEE_BANDS,
  GITHUB_MODEL_TIERS,
  GITHUB_PLANS,
  INDUSTRIES,
  M365_BASE_PLANS,
  MACC_BANDS,
  RAMP_CURVES,
  regionSchema,
  SEASONALITY_PROFILES,
  SECURITY_COVERAGE,
  SECURITY_DEPLOYMENT,
  VOICE_TIERS,
  WORKLOAD_IDS,
} from './taxonomy';

const pct = z.number().min(0).max(100);
const nonNegative = z.number().min(0).finite();
const positiveInt = z.number().int().min(0);

export const profileSchema = z.object({
  industry: z.enum(INDUSTRIES),
  region: regionSchema,
  employeeBand: z.enum(EMPLOYEE_BANDS),
  knowledgeWorkers: positiveInt.max(5_000_000),
  azureAgreement: z.enum(AZURE_AGREEMENTS),
  maccRemainingBand: z.enum(MACC_BANDS).optional(),
  maccMonthsRemaining: z.number().int().min(0).max(60).optional(),
  m365Base: z.enum(M365_BASE_PLANS),
});

export const m365CopilotUsageSchema = z.object({
  seatsNow: positiveInt.max(5_000_000),
  seats12m: positiveInt.max(5_000_000),
  rampCurve: z.enum(RAMP_CURVES),
});

export const m365CopilotChatUsageSchema = z.object({
  users: positiveInt.max(5_000_000),
  messagesPerUserPerDay: nonNegative.max(1000),
  businessDaysPerMonth: z.number().min(1).max(31),
  generativeSharePct: pct,
  graphGroundingPct: pct,
  m365CopilotLicensedPct: pct,
});

export const copilotStudioAgentsUsageSchema = z
  .object({
    agentsNow: positiveInt.max(100_000),
    agents12m: positiveInt.max(100_000),
    audience: z.enum(AUDIENCES),
    externalTrafficPct: pct,
    internalUsers: positiveInt.max(5_000_000),
    m365CopilotLicensedPct: pct,
    conversationsPerAgentPerDay: nonNegative.max(1_000_000),
    turnsPerConversation: nonNegative.max(500),
    mixClassicPct: pct,
    mixGenerativePct: pct,
    mixActionPct: pct,
    graphGroundingPct: pct,
    triggersFlows: z.boolean(),
    flowActionsPerConversation: nonNegative.max(1000),
    businessDaysPerMonth: z.number().min(1).max(31),
    seasonality: z.enum(SEASONALITY_PROFILES),
    peakMonthMultiplier: z.number().min(1).max(10),
    peakMonth: z.number().int().min(1).max(12),
  })
  .refine(
    (v) => Math.abs(v.mixClassicPct + v.mixGenerativePct + v.mixActionPct - 100) < 0.51,
    { message: 'Answer mix must total 100%', path: ['mixGenerativePct'] },
  );

export const copilotStudioFlowsUsageSchema = z.object({
  flowRunsPerMonth: nonNegative.max(100_000_000),
  actionsPerRun: nonNegative.max(1000),
  m365CopilotLicensedPct: pct,
});

export const sharepointAgentsUsageSchema = z.object({
  agentCount: positiveInt.max(100_000),
  usersPerAgent: positiveInt.max(1_000_000),
  messagesPerUserPerDay: nonNegative.max(1000),
  businessDaysPerMonth: z.number().min(1).max(31),
  graphGroundingPct: pct,
  m365CopilotLicensedPct: pct,
});

export const voiceAgentsUsageSchema = z.object({
  callsPerDay: nonNegative.max(10_000_000),
  avgHandleTimeMinutes: nonNegative.max(240),
  tier: z.enum(VOICE_TIERS),
  containmentRatePct: pct,
  businessDaysPerMonth: z.number().min(1).max(31),
});

export const aiToolsUsageSchema = z.object({
  documentsPerMonth: nonNegative.max(100_000_000),
  pagesPerDocument: nonNegative.max(10_000),
  modelTier: z.enum(AI_TOOL_TIERS),
  responsesPerMonth: nonNegative.max(100_000_000),
  tokensPerResponse: nonNegative.max(1_000_000),
  m365CopilotLicensedPct: pct,
});

export const d365AgentsUsageSchema = z.object({
  users: positiveInt.max(5_000_000),
  invocationsPerUserPerDay: nonNegative.max(1000),
  actionsPerInvocation: nonNegative.max(100),
  businessDaysPerMonth: z.number().min(1).max(31),
  m365CopilotLicensedPct: pct,
});

export const roleBasedCopilotsUsageSchema = z.object({
  users: positiveInt.max(5_000_000),
  interactionsPerUserPerDay: nonNegative.max(1000),
  actionsPerInteraction: nonNegative.max(100),
  businessDaysPerMonth: z.number().min(1).max(31),
  m365CopilotLicensedPct: pct,
});

export const securityCopilotUsageSchema = z.object({
  analysts: positiveInt.max(100_000),
  investigationsPerDay: nonNegative.max(1_000_000),
  scuMinutesPerInvestigation: nonNegative.max(10_000),
  coverage: z.enum(SECURITY_COVERAGE),
  deployment: z.enum(SECURITY_DEPLOYMENT),
});

export const githubCopilotUsageSchema = z.object({
  seats: positiveInt.max(1_000_000),
  plan: z.enum(GITHUB_PLANS),
  heavyUserPct: pct,
  modelTier: z.enum(GITHUB_MODEL_TIERS),
});

export const copilotCoworkUsageSchema = z.object({
  users: positiveInt.max(5_000_000),
  tasksPerUserPerMonth: nonNegative.max(100_000),
  m365CopilotLicensedPct: pct,
});

export const foundryByomUsageSchema = z.object({
  agentActionsPerMonth: nonNegative.max(1_000_000_000),
  inputTokensPerMonth: nonNegative.max(1e15),
  outputTokensPerMonth: nonNegative.max(1e15),
});

export const retrievalApiUsageSchema = z.object({
  queriesPerMonth: nonNegative.max(1_000_000_000),
});

export const usageSchema = z.object({
  'm365-copilot': m365CopilotUsageSchema.optional(),
  'm365-copilot-chat': m365CopilotChatUsageSchema.optional(),
  'copilot-studio-agents': copilotStudioAgentsUsageSchema.optional(),
  'copilot-studio-flows': copilotStudioFlowsUsageSchema.optional(),
  'sharepoint-agents': sharepointAgentsUsageSchema.optional(),
  'voice-agents': voiceAgentsUsageSchema.optional(),
  'ai-tools': aiToolsUsageSchema.optional(),
  'd365-agents': d365AgentsUsageSchema.optional(),
  'role-based-copilots': roleBasedCopilotsUsageSchema.optional(),
  'security-copilot': securityCopilotUsageSchema.optional(),
  'github-copilot': githubCopilotUsageSchema.optional(),
  'copilot-cowork': copilotCoworkUsageSchema.optional(),
  'foundry-byom': foundryByomUsageSchema.optional(),
  'retrieval-api': retrievalApiUsageSchema.optional(),
});

export const growthSchema = z.object({
  rampMonth1Pct: pct,
  rampMonth3Pct: pct,
  rampMonth6Pct: pct,
  rampMonth12Pct: pct,
  confidence: z.enum(CONFIDENCE_LEVELS),
  budgetTolerance: z.enum(BUDGET_TOLERANCES),
  costAttributionPerBu: z.boolean(),
  canCommitAnnually: z.boolean(),
  hasUnspentAzureCommitment: z.boolean(),
  commitmentExpiringWithinMonths: z.number().int().min(0).max(60).optional(),
});

export const consentSchema = z.object({
  contributeToBenchmark: z.boolean(),
  understandsPlanningEstimate: z.boolean(),
});

export const answersSchema = z.object({
  profile: profileSchema,
  workloads: z.array(z.enum(WORKLOAD_IDS)),
  usage: usageSchema,
  growth: growthSchema,
  consent: consentSchema,
});

export type Profile = z.infer<typeof profileSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type Growth = z.infer<typeof growthSchema>;
export type Consent = z.infer<typeof consentSchema>;
export type Answers = z.infer<typeof answersSchema>;

export type M365CopilotUsage = z.infer<typeof m365CopilotUsageSchema>;
export type M365CopilotChatUsage = z.infer<typeof m365CopilotChatUsageSchema>;
export type CopilotStudioAgentsUsage = z.infer<typeof copilotStudioAgentsUsageSchema>;
export type CopilotStudioFlowsUsage = z.infer<typeof copilotStudioFlowsUsageSchema>;
export type SharepointAgentsUsage = z.infer<typeof sharepointAgentsUsageSchema>;
export type VoiceAgentsUsage = z.infer<typeof voiceAgentsUsageSchema>;
export type AiToolsUsage = z.infer<typeof aiToolsUsageSchema>;
export type D365AgentsUsage = z.infer<typeof d365AgentsUsageSchema>;
export type RoleBasedCopilotsUsage = z.infer<typeof roleBasedCopilotsUsageSchema>;
export type SecurityCopilotUsage = z.infer<typeof securityCopilotUsageSchema>;
export type GithubCopilotUsage = z.infer<typeof githubCopilotUsageSchema>;
export type CopilotCoworkUsage = z.infer<typeof copilotCoworkUsageSchema>;
export type FoundryByomUsage = z.infer<typeof foundryByomUsageSchema>;
export type RetrievalApiUsage = z.infer<typeof retrievalApiUsageSchema>;

/**
 * Industry-neutral defaults. These are what "Skip — use industry default" applies.
 * Every default is deliberately mid-market and conservative.
 */
export const WORKLOAD_DEFAULTS = {
  'm365-copilot': { seatsNow: 100, seats12m: 500, rampCurve: 'phased-quarterly' },
  'm365-copilot-chat': {
    users: 1000,
    messagesPerUserPerDay: 4,
    businessDaysPerMonth: 21,
    generativeSharePct: 70,
    graphGroundingPct: 25,
    m365CopilotLicensedPct: 20,
  },
  'copilot-studio-agents': {
    agentsNow: 3,
    agents12m: 12,
    audience: 'internal',
    externalTrafficPct: 0,
    internalUsers: 1000,
    m365CopilotLicensedPct: 20,
    conversationsPerAgentPerDay: 150,
    turnsPerConversation: 6,
    mixClassicPct: 30,
    mixGenerativePct: 55,
    mixActionPct: 15,
    graphGroundingPct: 20,
    triggersFlows: true,
    flowActionsPerConversation: 2,
    businessDaysPerMonth: 21,
    seasonality: 'flat',
    peakMonthMultiplier: 1.5,
    peakMonth: 11,
  },
  'copilot-studio-flows': {
    flowRunsPerMonth: 20000,
    actionsPerRun: 6,
    m365CopilotLicensedPct: 20,
  },
  'sharepoint-agents': {
    agentCount: 10,
    usersPerAgent: 120,
    messagesPerUserPerDay: 2,
    businessDaysPerMonth: 21,
    graphGroundingPct: 80,
    m365CopilotLicensedPct: 20,
  },
  'voice-agents': {
    callsPerDay: 400,
    avgHandleTimeMinutes: 4,
    tier: 'genai',
    containmentRatePct: 60,
    businessDaysPerMonth: 21,
  },
  'ai-tools': {
    documentsPerMonth: 5000,
    pagesPerDocument: 4,
    modelTier: 'standard',
    responsesPerMonth: 20000,
    tokensPerResponse: 800,
    m365CopilotLicensedPct: 20,
  },
  'd365-agents': {
    users: 300,
    invocationsPerUserPerDay: 5,
    actionsPerInvocation: 1,
    businessDaysPerMonth: 21,
    m365CopilotLicensedPct: 20,
  },
  'role-based-copilots': {
    users: 250,
    interactionsPerUserPerDay: 6,
    actionsPerInteraction: 1,
    businessDaysPerMonth: 21,
    m365CopilotLicensedPct: 20,
  },
  'security-copilot': {
    analysts: 12,
    investigationsPerDay: 20,
    scuMinutesPerInvestigation: 12,
    coverage: '24x7',
    deployment: 'both',
  },
  'github-copilot': { seats: 200, plan: 'business', heavyUserPct: 30, modelTier: 'standard' },
  'copilot-cowork': { users: 200, tasksPerUserPerMonth: 20, m365CopilotLicensedPct: 20 },
  'foundry-byom': {
    agentActionsPerMonth: 50000,
    inputTokensPerMonth: 75_000_000,
    outputTokensPerMonth: 25_000_000,
  },
  'retrieval-api': { queriesPerMonth: 100_000 },
} as const satisfies Record<string, unknown>;

export function defaultAnswers(): Answers {
  return {
    profile: {
      industry: 'Other',
      region: 'Northern America',
      employeeBand: '1k-5k',
      knowledgeWorkers: 1000,
      azureAgreement: 'none',
      m365Base: 'E3',
    },
    workloads: [],
    usage: {},
    growth: {
      rampMonth1Pct: 15,
      rampMonth3Pct: 40,
      rampMonth6Pct: 70,
      rampMonth12Pct: 100,
      confidence: 'medium',
      budgetTolerance: 'tolerable',
      costAttributionPerBu: false,
      canCommitAnnually: false,
      hasUnspentAzureCommitment: false,
    },
    consent: { contributeToBenchmark: false, understandsPlanningEstimate: false },
  };
}

/** Returns the default usage block for a workload, typed to that workload's schema. */
export function defaultUsageFor<K extends keyof typeof WORKLOAD_DEFAULTS>(
  id: K,
): (typeof WORKLOAD_DEFAULTS)[K] {
  return WORKLOAD_DEFAULTS[id];
}
