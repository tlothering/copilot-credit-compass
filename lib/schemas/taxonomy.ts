/**
 * Fixed taxonomies. These are shape-only descriptors — never identity (constraint C1).
 */

export const INDUSTRIES = [
  'Financial Services',
  'Healthcare & Life Sciences',
  'Public Sector',
  'Manufacturing',
  'Retail & CPG',
  'Energy & Utilities',
  'Professional Services',
  'Education',
  'Technology & Software',
  'Telecommunications',
  'Transport & Logistics',
  'Non-profit',
  'Other',
] as const;

export const REGIONS = [
  'NA',
  'LATAM',
  'UK&I',
  'Western Europe',
  'Nordics',
  'CEE',
  'MEA',
  'India',
  'Japan',
  'ANZ',
  'ASEAN',
  'Greater China',
] as const;

export const EMPLOYEE_BANDS = [
  '1-50',
  '51-250',
  '251-1k',
  '1k-5k',
  '5k-25k',
  '25k-100k',
  '100k+',
] as const;

export const KNOWLEDGE_WORKER_BANDS = [
  '1-50',
  '51-250',
  '251-1k',
  '1k-5k',
  '5k-25k',
  '25k-100k',
  '100k+',
] as const;

export const AZURE_AGREEMENTS = ['none', 'payg', 'ea-mca', 'macc'] as const;

export const MACC_BANDS = ['<100k', '100k-500k', '500k-1m', '1m-5m', '5m+'] as const;

export const M365_BASE_PLANS = [
  'Business Basic',
  'Business Standard',
  'Business Premium',
  'E1',
  'E3',
  'E5',
  'F-series',
  'Mixed',
  'GCC',
  'GCC-High',
] as const;

export const WORKLOAD_IDS = [
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
] as const;

export const AUDIENCES = ['internal', 'external', 'both'] as const;
export const SEASONALITY_PROFILES = ['flat', 'business-hours-peak', 'seasonal-spike'] as const;
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export const BUDGET_TOLERANCES = ['never', 'tolerable', 'irrelevant'] as const;
export const RAMP_CURVES = ['big-bang', 'phased-quarterly', 'pilot-then-scale'] as const;
export const VOICE_TIERS = ['classic', 'genai', 'premium-genai'] as const;
export const AI_TOOL_TIERS = ['basic', 'standard', 'premium'] as const;
export const GITHUB_PLANS = ['business', 'enterprise'] as const;
export const GITHUB_MODEL_TIERS = ['economy', 'standard', 'premium'] as const;
export const SECURITY_COVERAGE = ['24x7', 'business-hours'] as const;
export const SECURITY_DEPLOYMENT = ['embedded', 'standalone', 'both'] as const;

export type Industry = (typeof INDUSTRIES)[number];
export type Region = (typeof REGIONS)[number];
export type EmployeeBand = (typeof EMPLOYEE_BANDS)[number];
export type KnowledgeWorkerBand = (typeof KNOWLEDGE_WORKER_BANDS)[number];
export type AzureAgreement = (typeof AZURE_AGREEMENTS)[number];
export type MaccBand = (typeof MACC_BANDS)[number];
export type M365BasePlan = (typeof M365_BASE_PLANS)[number];
export type WorkloadId = (typeof WORKLOAD_IDS)[number];
export type Audience = (typeof AUDIENCES)[number];
export type SeasonalityProfile = (typeof SEASONALITY_PROFILES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type BudgetTolerance = (typeof BUDGET_TOLERANCES)[number];
export type RampCurve = (typeof RAMP_CURVES)[number];
export type VoiceTier = (typeof VOICE_TIERS)[number];
export type AiToolTier = (typeof AI_TOOL_TIERS)[number];
export type GithubPlan = (typeof GITHUB_PLANS)[number];
export type GithubModelTier = (typeof GITHUB_MODEL_TIERS)[number];
export type SecurityCoverage = (typeof SECURITY_COVERAGE)[number];
export type SecurityDeployment = (typeof SECURITY_DEPLOYMENT)[number];

export interface WorkloadMeta {
  id: WorkloadId;
  label: string;
  blurb: string;
  /** Does this workload consume Copilot Credits? */
  meteredInCredits: boolean;
  /** Does it also carry a per-seat or provisioned licence cost? */
  hasSeatCost: boolean;
}

export const WORKLOADS: readonly WorkloadMeta[] = [
  {
    id: 'm365-copilot',
    label: 'Microsoft 365 Copilot',
    blurb: 'Per-user licence in Word, Excel, Outlook, Teams. Zero-rates core agent activity for its holders.',
    meteredInCredits: false,
    hasSeatCost: true,
  },
  {
    id: 'm365-copilot-chat',
    label: 'Microsoft 365 Copilot Chat',
    blurb: 'Pay-as-you-go agents inside Copilot Chat, metered on the Copilot Credit meter.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'copilot-studio-agents',
    label: 'Copilot Studio custom agents',
    blurb: 'Classic, generative and autonomous agents you build and publish yourself.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'copilot-studio-flows',
    label: 'Copilot Studio agent flows',
    blurb: 'Deterministic automation invoked by agents, billed per 100 flow actions.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'sharepoint-agents',
    label: 'SharePoint agents',
    blurb: 'Site-scoped agents grounded on SharePoint content, metered per message.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'voice-agents',
    label: 'Copilot voice agents',
    blurb: 'Contact-centre and IVR voice agents, billed per minute of conversation.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'ai-tools',
    label: 'AI tools / AI Builder',
    blurb: 'Text and generative AI tools plus document content processing.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'd365-agents',
    label: 'Dynamics 365 out-of-box agents',
    blurb: 'Prebuilt Sales, Service, Finance and Supply Chain agents.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'role-based-copilots',
    label: 'Role-based Copilots',
    blurb: 'Copilot for Sales, Service and Finance experiences.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'security-copilot',
    label: 'Microsoft Security Copilot',
    blurb: 'SOC assistant billed in provisioned Security Compute Units, not Copilot Credits.',
    meteredInCredits: false,
    hasSeatCost: true,
  },
  {
    id: 'github-copilot',
    label: 'GitHub Copilot',
    blurb: 'Developer seats with an included premium-request allowance and metered overage.',
    meteredInCredits: true,
    hasSeatCost: true,
  },
  {
    id: 'copilot-cowork',
    label: 'Copilot Cowork / Work IQ API',
    blurb: 'Usage-based agentic task execution billed in Copilot Credits.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'foundry-byom',
    label: 'Microsoft Foundry / BYOM',
    blurb: 'Bring your own model — agent action credits plus separate Azure token or PTU cost.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
  {
    id: 'retrieval-api',
    label: 'Microsoft 365 Copilot Retrieval API',
    blurb: 'Preview API for grounding your own apps on tenant content, metered per query.',
    meteredInCredits: true,
    hasSeatCost: false,
  },
];

export function workloadMeta(id: WorkloadId): WorkloadMeta {
  const found = WORKLOADS.find((w) => w.id === id);
  if (!found) throw new Error(`Unknown workload: ${id}`);
  return found;
}

/** Coarse midpoint used only for benchmark banding and never for identification. */
export function bandFromCount(count: number): EmployeeBand {
  if (count <= 50) return '1-50';
  if (count <= 250) return '51-250';
  if (count <= 1000) return '251-1k';
  if (count <= 5000) return '1k-5k';
  if (count <= 25000) return '5k-25k';
  if (count <= 100000) return '25k-100k';
  return '100k+';
}
