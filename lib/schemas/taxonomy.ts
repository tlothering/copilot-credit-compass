/**
 * Fixed taxonomies. These are shape-only descriptors — never identity (constraint C1).
 */

import { z } from 'zod';

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

/**
 * Geographic regions follow the UN M49 standard (UN Statistics Division,
 * "Standard Country or Area Codes for Statistical Use", Series M No. 49), which
 * is also the basis for Unicode CLDR territory containment.
 *
 * These replace an earlier list of Microsoft field/area names — NA, LATAM,
 * UK&I, Nordics, CEE, MEA, ANZ, ASEAN, Greater China — which were internal
 * commercial groupings rather than geography. Several were not regions at all:
 * ASEAN is a trade bloc, India and Japan are countries, and "Greater China" is
 * a contested political term. Anyone outside Microsoft's field organisation had
 * to guess which bucket they belonged to.
 *
 * The full sub-region level is used rather than a hand-picked subset. Trimming
 * it would re-create exactly the bespoke taxonomy this replaces, and the
 * benchmark's roll-up already absorbs thin cohorts by dropping the region.
 */
export const REGIONS = [
  // Africa
  'Northern Africa',
  'Sub-Saharan Africa',
  // Americas
  'Latin America and the Caribbean',
  'Northern America',
  // Asia
  'Central Asia',
  'Eastern Asia',
  'South-eastern Asia',
  'Southern Asia',
  'Western Asia',
  // Europe
  'Eastern Europe',
  'Northern Europe',
  'Southern Europe',
  'Western Europe',
  // Oceania
  'Australia and New Zealand',
  'Melanesia',
  'Micronesia',
  'Polynesia',
] as const;

/** The five M49 top-level regions, used to group the picker. */
export const REGION_GROUPS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'] as const;

export const REGION_GROUP: Record<(typeof REGIONS)[number], (typeof REGION_GROUPS)[number]> = {
  'Northern Africa': 'Africa',
  'Sub-Saharan Africa': 'Africa',
  'Latin America and the Caribbean': 'Americas',
  'Northern America': 'Americas',
  'Central Asia': 'Asia',
  'Eastern Asia': 'Asia',
  'South-eastern Asia': 'Asia',
  'Southern Asia': 'Asia',
  'Western Asia': 'Asia',
  'Eastern Europe': 'Europe',
  'Northern Europe': 'Europe',
  'Southern Europe': 'Europe',
  'Western Europe': 'Europe',
  'Australia and New Zealand': 'Oceania',
  Melanesia: 'Oceania',
  Micronesia: 'Oceania',
  Polynesia: 'Oceania',
};

/**
 * Ready-made picker options, grouped by parent region. Structurally satisfies
 * the UI `Option` type without taxonomy needing to import from components, and
 * without either picker restating the mapping. REGIONS is already ordered by
 * parent region, so the group runs are contiguous.
 */
export const REGION_OPTIONS = REGIONS.map((r) => ({
  value: r,
  label: r,
  group: REGION_GROUP[r],
}));

/**
 * Legacy Microsoft area names mapped onto their M49 equivalent.
 *
 * Both benchmark stores parse stored documents with `safeParse` and silently
 * drop anything that fails, so without this map every record submitted under
 * the old taxonomy would vanish from the benchmark with no error anywhere. It
 * also covers a browser holding a cached bundle, or a half-finished session
 * restored from sessionStorage, across the deployment that changes the list.
 *
 * Most mappings are exact: M49 places the UK, Ireland and the Nordics all in
 * Northern Europe, and Australia and New Zealand is a sub-region in its own
 * right. Two are lossy and are called out in DECISIONS.md:
 *
 *   - MEA spanned Western Asia *and* both African sub-regions. A legacy record
 *     cannot tell us which, so it resolves to Western Asia. Some African
 *     respondents will have been relabelled. This ambiguity is the reason for
 *     moving to a standard, not an argument against it.
 *   - Microsoft's "Western Europe" often included Italy, Spain and Portugal,
 *     which M49 places in Southern Europe. The label is unchanged, so those
 *     records pass through as Western Europe.
 */
export const LEGACY_REGION_ALIASES: Record<string, (typeof REGIONS)[number]> = {
  NA: 'Northern America',
  LATAM: 'Latin America and the Caribbean',
  'UK&I': 'Northern Europe',
  Nordics: 'Northern Europe',
  CEE: 'Eastern Europe',
  MEA: 'Western Asia',
  India: 'Southern Asia',
  Japan: 'Eastern Asia',
  ANZ: 'Australia and New Zealand',
  ASEAN: 'South-eastern Asia',
  'Greater China': 'Eastern Asia',
};

/**
 * Resolves any region string — current or legacy — to a current one, or null if
 * it is neither. Used as a Zod preprocessor so historical data survives.
 */
export function normaliseRegion(value: unknown): (typeof REGIONS)[number] | null {
  if (typeof value !== 'string') return null;
  if ((REGIONS as readonly string[]).includes(value)) return value as (typeof REGIONS)[number];
  return LEGACY_REGION_ALIASES[value] ?? null;
}

/**
 * The one region validator. Both the answer schema and the benchmark record
 * schema use it, so a legacy value migrates identically whether it arrives from
 * a restored session, a cached client bundle, or a document already in the
 * store. An unrecognised value is left untouched for `z.enum` to reject with
 * its usual message rather than being swallowed here.
 */
export const regionSchema = z.preprocess(
  (v) => normaliseRegion(v) ?? v,
  z.enum(REGIONS),
);

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
    blurb:
      'Developer seats with a pooled AI credit allowance and metered overage. Code completions are unlimited and never billed.',
    meteredInCredits: true,
    hasSeatCost: true,
  },
  {
    id: 'copilot-cowork',
    label: 'Copilot Cowork / Work IQ API',
    blurb:
      'Usage-based agentic task execution billed in Copilot Credits, and not zero-rated by a Microsoft 365 Copilot seat.',
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
