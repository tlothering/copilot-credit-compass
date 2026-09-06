import {
  AI_TOOL_TIERS,
  AUDIENCES,
  GITHUB_MODEL_TIERS,
  GITHUB_PLANS,
  RAMP_CURVES,
  SEASONALITY_PROFILES,
  SECURITY_COVERAGE,
  SECURITY_DEPLOYMENT,
  VOICE_TIERS,
  type WorkloadId,
} from '@/lib/schemas/taxonomy';

export type FieldKind = 'number' | 'percent' | 'select' | 'toggle';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  why: string;
  effect: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { value: string; label: string }[];
  /** Only render when this predicate passes against the workload's current answers. */
  showIf?: (v: Record<string, unknown>) => boolean;
  /** Groups fields that must total 100. */
  sumGroup?: string;
}

const opt = <T extends string>(values: readonly T[], label: (v: T) => string = (v) => v) =>
  values.map((v) => ({ value: v as string, label: label(v) }));

const BUSINESS_DAYS: FieldSpec = {
  key: 'businessDaysPerMonth',
  label: 'Business days per month',
  kind: 'number',
  min: 1,
  max: 31,
  suffix: 'days',
  why: 'Consumption is driven by working days, not calendar days. Twenty-one is the standard commercial assumption.',
  effect: 'Linear. A 24×7 operation at 30 days consumes roughly 43% more than a 21-day working month.',
};

const LICENSED_PCT = (extra = ''): FieldSpec => ({
  key: 'm365CopilotLicensedPct',
  label: 'Share of these users holding a Microsoft 365 Copilot licence',
  kind: 'percent',
  why: `A Microsoft 365 Copilot seat carries a monthly included credit allowance. Traffic from those users is offset against the allowance before anything is billed.${extra ? ` ${extra}` : ''}`,
  effect: 'Very large. This is the single biggest lever in the model — it directly reduces billable credits and drives the licence-offset break-even.',
});

/**
 * Cowork is the exception: task execution draws Copilot Credits against the
 * organisation's Microsoft 365 usage-based billing limit and is NOT zero-rated
 * by holding a Microsoft 365 Copilot seat, unlike core Copilot Studio agent
 * activity. The share is still collected because it feeds the licence-offset
 * break-even, but it must not be presented as an offset here.
 */
const LICENSED_PCT_NO_OFFSET: FieldSpec = {
  key: 'm365CopilotLicensedPct',
  label: 'Share of these users holding a Microsoft 365 Copilot licence',
  kind: 'percent',
  why: 'Recorded for the licence-offset break-even across your estate. Note that, unlike Copilot Studio agent activity, Cowork task execution is not zero-rated by a Microsoft 365 Copilot seat — it consumes Copilot Credits against your Microsoft 365 usage-based billing limit either way.',
  effect: 'None on Cowork credits, which are billed in full regardless. Contributes to the estate-wide break-even.',
};

export const USAGE_SPEC: Record<WorkloadId, FieldSpec[]> = {
  'm365-copilot': [
    {
      key: 'seatsNow',
      label: 'Microsoft 365 Copilot seats today',
      kind: 'number',
      suffix: 'seats',
      why: 'Seats already deployed set the starting point of the ramp and the credit allowance you already own.',
      effect: 'Each seat is a fixed monthly licence cost and contributes an included credit allowance that offsets metered use.',
    },
    {
      key: 'seats12m',
      label: 'Seats you expect in twelve months',
      kind: 'number',
      suffix: 'seats',
      why: 'The end state of your licence ramp determines both the platform cost and the size of the offset pool.',
      effect: 'Raises fixed licence cost but lowers billable credits. The engine works out whether that trade is worth it.',
    },
    {
      key: 'rampCurve',
      label: 'How the rollout is phased',
      kind: 'select',
      options: opt(RAMP_CURVES, (v) =>
        v === 'big-bang'
          ? 'Big bang — everyone at once'
          : v === 'phased-quarterly'
            ? 'Phased quarterly'
            : 'Pilot, then scale',
      ),
      why: 'The shape of the rollout changes when cost lands, not just how much.',
      effect: 'Shifts spend between months. A pilot-then-scale curve defers cost but concentrates volatility late in the year.',
    },
  ],

  'm365-copilot-chat': [
    {
      key: 'users',
      label: 'People using Copilot Chat',
      kind: 'number',
      suffix: 'users',
      why: 'Chat is metered per message, so the active population is the base of the whole calculation.',
      effect: 'Linear on billable credits before the licence offset is applied.',
    },
    {
      key: 'messagesPerUserPerDay',
      label: 'Messages per user per business day',
      kind: 'number',
      step: 0.5,
      suffix: 'messages',
      why: 'Message frequency separates casual triallists from genuine daily users, and the two differ by an order of magnitude.',
      effect: 'Linear. Four a day is typical adoption; twenty a day is power use and roughly doubles the licence-shift case.',
    },
    BUSINESS_DAYS,
    {
      key: 'generativeSharePct',
      label: 'Share of messages that need a generative answer',
      kind: 'percent',
      why: 'Generative answers invoke a model and are metered far higher than scripted or retrieval-only responses.',
      effect: 'Large. Generative messages cost several times a classic response on the credit meter.',
    },
    {
      key: 'graphGroundingPct',
      label: 'Share of messages grounded on Microsoft Graph',
      kind: 'percent',
      why: 'Grounding on tenant data adds a separate metered charge on top of the answer itself.',
      effect: 'Adds an incremental per-message charge for the grounded proportion only.',
    },
    LICENSED_PCT(),
  ],

  'copilot-studio-agents': [
    {
      key: 'agentsNow',
      label: 'Agents in production today',
      kind: 'number',
      suffix: 'agents',
      why: 'Agent count multiplies conversation volume. It is the clearest signal of programme maturity.',
      effect: 'Linear against conversations per agent.',
    },
    {
      key: 'agents12m',
      label: 'Agents in production in twelve months',
      kind: 'number',
      suffix: 'agents',
      why: 'Where the estate lands sets the steady-state run rate the funding decision is sized on.',
      effect: 'Sets the month-12 volume. The whole twelve-month plan is anchored on this number.',
    },
    {
      key: 'audience',
      label: 'Who uses these agents',
      kind: 'select',
      options: opt(AUDIENCES, (v) =>
        v === 'internal' ? 'Internal employees' : v === 'external' ? 'External customers' : 'Both',
      ),
      why: 'Only internal traffic from licensed users can be offset against a Microsoft 365 Copilot allowance. External traffic never can.',
      effect: 'Large. External-heavy agents cannot be funded by shifting licences and must be metered or prepaid.',
    },
    {
      key: 'externalTrafficPct',
      label: 'Share of conversations from external users',
      kind: 'percent',
      showIf: (v) => v.audience === 'both',
      why: 'We need the split to know how much of the volume is offsettable.',
      effect: 'Directly reduces the offsettable pool.',
    },
    {
      key: 'internalUsers',
      label: 'Distinct internal users across all agents',
      kind: 'number',
      suffix: 'users',
      why: 'The internal population caps how many licences a licence-shift strategy would need.',
      effect: 'Sizes the licence-shift option and is bounded by your knowledge-worker count.',
    },
    LICENSED_PCT(),
    {
      key: 'conversationsPerAgentPerDay',
      label: 'Conversations per agent per business day',
      kind: 'number',
      suffix: 'conversations',
      why: 'This is the core throughput driver and the number most often underestimated.',
      effect: 'Linear on everything downstream. Getting this wrong by 2× moves the whole forecast by 2×.',
    },
    {
      key: 'turnsPerConversation',
      label: 'Average turns per conversation',
      kind: 'number',
      step: 0.5,
      suffix: 'turns',
      why: 'Billing happens per turn, not per conversation. Long clarification loops are expensive.',
      effect: 'Linear. Six turns is typical; a poorly scoped agent can run to fifteen.',
    },
    {
      key: 'mixClassicPct',
      label: 'Scripted / classic answers',
      kind: 'percent',
      sumGroup: 'mix',
      why: 'Classic deterministic answers are the cheapest response type on the meter.',
      effect: 'Shifting mix towards classic is the fastest way to cut consumption without cutting usage.',
    },
    {
      key: 'mixGenerativePct',
      label: 'Generative (LLM) answers',
      kind: 'percent',
      sumGroup: 'mix',
      why: 'Generative answers invoke a model and carry the highest per-turn rate of the three.',
      effect: 'Dominant cost driver in most agent estates.',
    },
    {
      key: 'mixActionPct',
      label: 'Actions against a system of record',
      kind: 'percent',
      sumGroup: 'mix',
      why: 'Actions that read or write to a back-end system are metered separately from the conversation.',
      effect: 'Mid-priced, but they compound with flow actions below.',
    },
    {
      key: 'graphGroundingPct',
      label: 'Share of turns grounded on Microsoft Graph',
      kind: 'percent',
      why: 'Tenant grounding is an additional metered event on top of the turn.',
      effect: 'Incremental charge on the grounded proportion.',
    },
    {
      key: 'triggersFlows',
      label: 'Agents trigger automation flows',
      kind: 'toggle',
      why: 'Flow actions bill on a separate per-hundred-actions meter that is easy to overlook.',
      effect: 'Turns on an additional cost line sized by the field below.',
    },
    {
      key: 'flowActionsPerConversation',
      label: 'Average flow actions per conversation',
      kind: 'number',
      step: 0.5,
      suffix: 'actions',
      showIf: (v) => v.triggersFlows === true,
      why: 'Automation depth varies enormously — a lookup is one action, an order orchestration can be twenty.',
      effect: 'Linear on the flow-actions meter.',
    },
    BUSINESS_DAYS,
    {
      key: 'seasonality',
      label: 'Seasonality profile',
      kind: 'select',
      options: opt(SEASONALITY_PROFILES, (v) =>
        v === 'flat'
          ? 'Flat across the year'
          : v === 'business-hours-peak'
            ? 'Business-hours peak, flat monthly total'
            : 'Seasonal spike in one month',
      ),
      why: 'Volatility, not just volume, determines whether prepaid capacity is a good idea.',
      effect: 'A spiky profile raises the coefficient of variation, which penalises rigid prepaid options in the scoring.',
    },
    {
      key: 'peakMonthMultiplier',
      label: 'Peak month multiplier',
      kind: 'number',
      min: 1,
      max: 10,
      step: 0.1,
      suffix: '×',
      showIf: (v) => v.seasonality === 'seasonal-spike',
      why: 'The height of the spike decides how much headroom any prepaid commitment needs.',
      effect: 'Raises the peak-month cost and widens the scenario band.',
    },
    {
      key: 'peakMonth',
      label: 'Which month peaks',
      kind: 'number',
      min: 1,
      max: 12,
      showIf: (v) => v.seasonality === 'seasonal-spike',
      why: 'Timing matters for cash flow and for when a prepaid balance would run dry.',
      effect: 'Moves the spike within the twelve-month curve. Does not change the annual total.',
    },
  ],

  'copilot-studio-flows': [
    {
      key: 'flowRunsPerMonth',
      label: 'Flow runs per month',
      kind: 'number',
      suffix: 'runs',
      why: 'Agent flows are deterministic automation billed independently of conversations.',
      effect: 'Linear against actions per run on the per-hundred-actions meter.',
    },
    {
      key: 'actionsPerRun',
      label: 'Average actions per run',
      kind: 'number',
      step: 0.5,
      suffix: 'actions',
      why: 'Billing is per action, not per run, so a small number of deep flows can outweigh many shallow ones.',
      effect: 'Linear.',
    },
    LICENSED_PCT(),
  ],

  'sharepoint-agents': [
    {
      key: 'agentCount',
      label: 'SharePoint agents published',
      kind: 'number',
      suffix: 'agents',
      why: 'Site-scoped agents proliferate quickly because any site owner can create one.',
      effect: 'Linear against users per agent.',
    },
    {
      key: 'usersPerAgent',
      label: 'Average users per agent',
      kind: 'number',
      suffix: 'users',
      why: 'Reach per agent varies from a team of ten to an intranet-wide audience.',
      effect: 'Linear.',
    },
    {
      key: 'messagesPerUserPerDay',
      label: 'Messages per user per business day',
      kind: 'number',
      step: 0.5,
      suffix: 'messages',
      why: 'SharePoint agents are usually consulted occasionally rather than used continuously.',
      effect: 'Linear on billable messages.',
    },
    BUSINESS_DAYS,
    {
      key: 'graphGroundingPct',
      label: 'Share of messages grounded on Microsoft Graph',
      kind: 'percent',
      why: 'SharePoint agents ground on tenant content by design, so this is usually high.',
      effect: 'Adds the grounding charge to most messages.',
    },
    LICENSED_PCT(),
  ],

  'voice-agents': [
    {
      key: 'callsPerDay',
      label: 'Calls handled per business day',
      kind: 'number',
      suffix: 'calls',
      why: 'Voice bills per minute of conversation, so call volume and length together set the cost.',
      effect: 'Linear on billable minutes.',
    },
    {
      key: 'avgHandleTimeMinutes',
      label: 'Average handle time',
      kind: 'number',
      step: 0.5,
      max: 240,
      suffix: 'minutes',
      why: 'Handle time is the direct multiplier on the per-minute meter.',
      effect: 'Linear. Shaving thirty seconds off a four-minute call cuts voice cost by an eighth.',
    },
    {
      key: 'tier',
      label: 'Voice tier',
      kind: 'select',
      options: opt(VOICE_TIERS, (v) =>
        v === 'classic'
          ? 'Classic voice'
          : v === 'genai'
            ? 'GenAI voice'
            : 'Premium GenAI voice',
      ),
      why: 'The three tiers differ substantially in per-minute rate and in what they can do.',
      effect: 'Large. Premium GenAI is a multiple of classic on the same minute count.',
    },
    {
      key: 'containmentRatePct',
      label: 'Containment rate',
      kind: 'percent',
      why: 'Contained calls are resolved by the agent. Escalated calls still consume agent minutes before transferring.',
      effect: 'Escalated calls are modelled at half the handle time, so low containment reduces credits but raises your human cost elsewhere.',
    },
    BUSINESS_DAYS,
  ],

  'ai-tools': [
    {
      key: 'documentsPerMonth',
      label: 'Documents processed per month',
      kind: 'number',
      suffix: 'documents',
      why: 'Content processing bills per page, so document throughput is the base driver.',
      effect: 'Linear against pages per document.',
    },
    {
      key: 'pagesPerDocument',
      label: 'Average pages per document',
      kind: 'number',
      step: 0.5,
      suffix: 'pages',
      why: 'Page count is what is actually metered, not document count.',
      effect: 'Linear. Invoice extraction at two pages behaves very differently to contract review at forty.',
    },
    {
      key: 'modelTier',
      label: 'Model tier',
      kind: 'select',
      options: opt(AI_TOOL_TIERS, (v) => v[0]!.toUpperCase() + v.slice(1)),
      why: 'Tier changes the per-token rate applied to generative responses.',
      effect: 'Multiplicative on the token line.',
    },
    {
      key: 'responsesPerMonth',
      label: 'Generative responses per month',
      kind: 'number',
      suffix: 'responses',
      why: 'Separate from document processing — this is text generation and classification work.',
      effect: 'Linear against tokens per response.',
    },
    {
      key: 'tokensPerResponse',
      label: 'Average tokens per response',
      kind: 'number',
      step: 50,
      suffix: 'tokens',
      why: 'Token length is the true unit of billing for generative AI tools.',
      effect: 'Linear. Long-form generation at 4,000 tokens costs five times an 800-token summary.',
    },
    LICENSED_PCT(),
  ],

  'd365-agents': [
    {
      key: 'users',
      label: 'Dynamics 365 users with agents enabled',
      kind: 'number',
      suffix: 'users',
      why: 'Out-of-box agents are metered on invocation, so the enabled population sets the ceiling.',
      effect: 'Linear.',
    },
    {
      key: 'invocationsPerUserPerDay',
      label: 'Agent invocations per user per business day',
      kind: 'number',
      step: 0.5,
      suffix: 'invocations',
      why: 'Embedded agents are invoked far more often than standalone ones because they sit in the workflow.',
      effect: 'Linear on billable actions.',
    },
    {
      key: 'actionsPerInvocation',
      label: 'Actions per invocation',
      kind: 'number',
      step: 0.5,
      suffix: 'actions',
      why: 'A single invocation may chain several metered actions against the record.',
      effect: 'Linear multiplier on invocations.',
    },
    BUSINESS_DAYS,
    LICENSED_PCT(),
  ],

  'role-based-copilots': [
    {
      key: 'users',
      label: 'Users on role-based Copilots',
      kind: 'number',
      suffix: 'users',
      why: 'Copilot for Sales, Service and Finance are metered on interaction volume.',
      effect: 'Linear.',
    },
    {
      key: 'interactionsPerUserPerDay',
      label: 'Interactions per user per business day',
      kind: 'number',
      step: 0.5,
      suffix: 'interactions',
      why: 'Role-based Copilots sit in a daily workflow, so frequency is usually high.',
      effect: 'Linear on billable actions.',
    },
    {
      key: 'actionsPerInteraction',
      label: 'Actions per interaction',
      kind: 'number',
      step: 0.5,
      suffix: 'actions',
      why: 'Summarising an opportunity and drafting a follow-up are two metered actions, not one.',
      effect: 'Linear multiplier.',
    },
    BUSINESS_DAYS,
    LICENSED_PCT(),
  ],

  'security-copilot': [
    {
      key: 'analysts',
      label: 'SOC analysts using Security Copilot',
      kind: 'number',
      suffix: 'analysts',
      why: 'Security Copilot is provisioned in Security Compute Units, not Copilot Credits, so it is sized on capacity rather than events.',
      effect: 'Contextual. SCU cost sits on the platform line and never touches the credit meter.',
    },
    {
      key: 'investigationsPerDay',
      label: 'Investigations per day',
      kind: 'number',
      suffix: 'investigations',
      why: 'Investigation volume and depth together determine the SCU capacity you must provision.',
      effect: 'Drives required SCUs, which are billed hourly whether used or not.',
    },
    {
      key: 'scuMinutesPerInvestigation',
      label: 'SCU-minutes per investigation',
      kind: 'number',
      step: 0.5,
      suffix: 'SCU-minutes',
      why: 'Deep threat hunting consumes many times the compute of a routine alert triage.',
      effect: 'Linear on required capacity.',
    },
    {
      key: 'coverage',
      label: 'Coverage model',
      kind: 'select',
      options: opt(SECURITY_COVERAGE, (v) =>
        v === '24x7' ? '24×7 continuous' : 'Business hours only',
      ),
      why: 'Provisioned capacity bills by the hour it is up, so coverage hours matter more than usage.',
      effect: 'Large. 24×7 provisioning costs roughly three times business-hours-only for the same workload.',
    },
    {
      key: 'deployment',
      label: 'Where analysts use it',
      kind: 'select',
      options: opt(SECURITY_DEPLOYMENT, (v) =>
        v === 'embedded'
          ? 'Embedded in Defender and Sentinel'
          : v === 'standalone'
            ? 'Standalone portal'
            : 'Both',
      ),
      why: 'Recorded for completeness and for the audit trail. Both experiences draw on the same provisioned SCU pool.',
      effect: 'None on cost in this model — it is captured so the assumption is explicit rather than hidden.',
    },
  ],

  'github-copilot': [
    {
      key: 'seats',
      label: 'Developer seats',
      kind: 'number',
      suffix: 'seats',
      why: 'GitHub Copilot is a per-seat product. Each seat contributes an AI credit allowance to a pool shared across the whole billing entity.',
      effect: 'Fixed seat cost plus a pooled allowance that offsets AI credit overage. Code completions and next edit suggestions are unlimited and never billed.',
    },
    {
      key: 'plan',
      label: 'Plan',
      kind: 'select',
      options: opt(GITHUB_PLANS, (v) => (v === 'business' ? 'Copilot Business' : 'Copilot Enterprise')),
      why: 'Business and Enterprise differ in seat price and in the size of the included AI credit allowance (1,900 against 3,900 per user per month).',
      effect: 'Enterprise costs more per seat but includes a larger allowance, so heavy estates can be cheaper on Enterprise.',
    },
    {
      key: 'heavyUserPct',
      label: 'Share who are heavy agent or code-review users',
      kind: 'percent',
      why: 'A minority of developers generate the overwhelming majority of AI credit consumption, and because the allowance is pooled they draw on quieter colleagues\u2019 share before anyone pays overage.',
      effect: 'Large. Overage is concentrated almost entirely in this group.',
    },
    {
      key: 'modelTier',
      label: 'Preferred model tier',
      kind: 'select',
      options: opt(GITHUB_MODEL_TIERS, (v) => v[0]!.toUpperCase() + v.slice(1)),
      why: 'GitHub bills by model and token volume, so premium models consume more AI credits per interaction.',
      effect: 'Multiplicative on AI credit consumption and therefore on overage. There is no automatic fallback to a cheaper model when the pool runs out.',
    },
  ],

  'copilot-cowork': [
    {
      key: 'users',
      label: 'Users on Copilot Cowork or the Work IQ API',
      kind: 'number',
      suffix: 'users',
      why: 'Agentic task execution is billed purely on usage, with no seat licence to offset it.',
      effect: 'Linear against tasks per user.',
    },
    {
      key: 'tasksPerUserPerMonth',
      label: 'Agentic tasks per user per month',
      kind: 'number',
      suffix: 'tasks',
      why: 'Tasks are multi-step and cost considerably more than a single chat message.',
      effect: 'Linear, at a materially higher per-unit rate than chat.',
    },
    LICENSED_PCT_NO_OFFSET,
  ],

  'foundry-byom': [
    {
      key: 'agentActionsPerMonth',
      label: 'Agent actions per month',
      kind: 'number',
      suffix: 'actions',
      why: 'Bringing your own model still incurs Copilot agent-action credits for orchestration.',
      effect: 'Linear on the credit meter, separately from the Azure token cost below.',
    },
    {
      key: 'inputTokensPerMonth',
      label: 'Input tokens per month',
      kind: 'number',
      step: 1_000_000,
      suffix: 'tokens',
      why: 'Azure AI token consumption is billed directly to your Azure subscription, not the Copilot meter.',
      effect: 'Sits on the platform cost line and is MACC-eligible, which is often why this option wins.',
    },
    {
      key: 'outputTokensPerMonth',
      label: 'Output tokens per month',
      kind: 'number',
      step: 1_000_000,
      suffix: 'tokens',
      why: 'Output tokens are priced several times higher than input tokens.',
      effect: 'Usually the dominant half of the Azure token bill despite being the smaller count.',
    },
  ],

  'retrieval-api': [
    {
      key: 'queriesPerMonth',
      label: 'Retrieval API queries per month',
      kind: 'number',
      suffix: 'queries',
      why: 'The Retrieval API lets your own applications ground on tenant content, metered per query.',
      effect: 'Linear. Note this traffic is internal but cannot be offset by a Microsoft 365 Copilot licence.',
    },
  ],
};
