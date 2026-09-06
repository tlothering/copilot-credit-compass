import type { Answers } from '@/lib/schemas/answers';
import type {
  ConfidenceLevel,
  SeasonalityProfile,
  WorkloadId,
} from '@/lib/schemas/taxonomy';

export type { Answers };

/* ------------------------------------------------------------------ */
/* Rate card                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Credit currencies                                                   */
/* ------------------------------------------------------------------ */

/**
 * Two different things are called a "credit" in this problem space, and they are not
 * interchangeable. A Microsoft Copilot Credit is billed by Microsoft against the tenant
 * and can be funded by a capacity pack, the pre-purchase plan, a MACC burn-down or an
 * Azure prepayment. A GitHub AI credit is billed by GitHub against the organisation's
 * usage-based billing account and none of those vehicles can pay for it. They happen to
 * share a $0.01 unit price, which is exactly why conflating them is easy and wrong.
 */
export type CreditCurrencyId = 'microsoft-copilot-credit' | 'github-ai-credit';

export interface CreditCurrency {
  label: string;
  unitUsd: number;
  meter: string;
  meterNote: string;
  /** Funding option ids that can pay for this currency. Empty means "its own meter only". */
  fundableBy: FundingOptionId[];
  verified: boolean;
  sourceUrl: string;
}

export interface ConsumptionRate {
  label: string;
  credits: number;
  /** Which meter this rate is billed against. See {@link CreditCurrencyId}. */
  currency: CreditCurrencyId;
  unit: string;
  displayRate: string;
  offsetByM365CopilotLicence: boolean;
  /** Why a row is (or is not) zero-rated, where the answer is counter-intuitive. */
  offsetNote?: string;
  verified: boolean;
  sourceUrl: string;
  note?: string;
}

export interface SimpleCommercialRate {
  label: string;
  value: number;
  unit: string;
  verified: boolean;
  sourceUrl: string;
  note?: string;
}

export interface CapacityPackRate {
  label: string;
  monthlyUsd: number;
  credits: number;
  effectiveUsdPerCredit: number;
  rollsOver: boolean;
  resetDayOfMonth: number;
  verified: boolean;
  sourceUrl: string;
  note?: string;
}

export interface SecurityCopilotRate {
  label: string;
  provisionedScuHourUsd: number;
  overageScuHourUsd: number;
  minimumScu: number;
  verified: boolean;
  sourceUrl: string;
}

export interface GithubCopilotPlanRate {
  label: string;
  seatMonthlyUsd: number;
  includedAiCreditsPerUserPerMonth: number;
}

/**
 * GitHub Copilot billing, on the AI credits model GitHub moved to on
 * 2026-06-01. It replaced premium requests entirely.
 *
 * Two things here are load-bearing and routinely misunderstood:
 *
 *  - Code completions and next edit suggestions are unlimited and never billed
 *    on a paid plan. Only chat, CLI, the cloud agent, Spaces, Spark and
 *    third-party coding agents draw credits. Assuming completions are metered
 *    is the single most common reason a customer over-buys.
 *  - The included allowance is pooled across the billing entity, not
 *    ring-fenced per user, so a handful of heavy users can consume quiet
 *    colleagues' share before anyone hits overage.
 */
export interface GithubCopilotRate {
  label: string;
  billingModel: 'ai-credits';
  billingModelEffectiveDate: string;
  aiCreditUsd: number;
  poolScope: 'billing-entity';
  poolNote: string;
  creditsRollOver: boolean;
  poolResetDayOfMonth: number;
  poolResetTimeUtc: string;
  overageEnabledByDefault: boolean;
  overageCreditUsd: number;
  overagePolicyName: string;
  /** GitHub does not silently downgrade the model when the pool is exhausted. */
  automaticFallbackToCheaperModel: boolean;
  userLevelBudgetsCanHaltIndividual: boolean;
  codeCompletionsBilled: boolean;
  nextEditSuggestionsBilled: boolean;
  unlimitedOnPaidPlans: string[];
  billedFeatures: string[];
  plans: { business: GithubCopilotPlanRate; enterprise: GithubCopilotPlanRate };
  /**
   * The launch promotion, retained after expiry purely so the UI can explain to
   * someone who remembers 3,000 or 7,000 credits why their allowance dropped.
   */
  promotionalAllowance: {
    label: string;
    expired: boolean;
    startDate: string;
    endDate: string;
    business: number;
    enterprise: number;
    note: string;
    verified: boolean;
  };
  verified: boolean;
  sourceUrl: string;
  usagePageUrl: string;
  /** Estimated planning placeholders — GitHub publishes no per-interaction table. */
  interactionArchetypes: {
    id: string;
    label: string;
    blurb: string;
    creditsLow: number;
    creditsTypical: number;
    creditsHigh: number;
    verified: boolean;
  }[];
  interactionArchetypeNote: string;
}

export interface FoundryRate {
  label: string;
  inputPerMillionTokensUsd: number;
  outputPerMillionTokensUsd: number;
  verified: boolean;
  sourceUrl: string;
  note?: string;
}

export interface P3Tier {
  commitUnits: number;
  discountPct: number;
  verified: boolean;
}

export interface P3Plan {
  label: string;
  termMonths: number;
  usdRetailPaidDownPerCommitUnit: number;
  purchasedAs: string;
  cancellable: boolean;
  exchangeable: boolean;
  splittable: boolean;
  mergeable: boolean;
  autoRenews: boolean;
  stacksWithNegotiatedDiscounts: boolean;
  deductedFromAzurePrepaymentBalance: boolean;
  separateInvoiceLineItem: boolean;
  overageFallsBackToPayg: boolean;
  scopes: string[];
  tiers: P3Tier[];
  note: string;
  sourceUrl: string;
}

export type MaccEligibilityValue = 'yes' | 'no' | 'verify';

export interface MaccEligibility {
  label: string;
  paygCredits: MaccEligibilityValue;
  p3PrePurchase: MaccEligibilityValue;
  capacityPacks: MaccEligibilityValue;
  foundryTokens: MaccEligibilityValue;
  m365CopilotSeats: MaccEligibilityValue;
  note: string;
  verified: boolean;
  sourceUrl: string;
}

export interface ModelAssumptions {
  businessDaysPerMonth: number;
  hoursPerMonth: number;
  businessHoursPerDay: number;
  businessHoursDaysPerMonth: number;
  escalatedCallHandleShare: number;
  byomInputTokensPerGenerativeAnswer: number;
  byomOutputTokensPerGenerativeAnswer: number;
  packSizingPercentile: number;
  packSizingPercentileWhenVolatile: number;
  maxAcceptableWastePct: number;
  volatilityThreshold: number;
  sensitivityPerturbationPct: number;
  /** Log-normal sigma used to spread per-user credit consumption around its mean. */
  usageDistributionSigma: number;
  confidenceMultipliers: Record<
    ConfidenceLevel,
    { conservative: number; expected: number; aggressive: number }
  >;
  githubAiCreditsPerHeavyUserPerMonth: number;
  githubAiCreditsPerStandardUserPerMonth: number;
  githubAiCreditAssumptionNote: string;
  githubModelTierMultiplier: Record<'economy' | 'standard' | 'premium', number>;
  kAnonymityMinimum: number;
  outlierMaxMonthlyCredits: number;
}

export type ConsumptionRateId =
  | 'classic-answer'
  | 'generative-answer'
  | 'agent-action'
  | 'tenant-graph-grounding'
  | 'agent-flow-action'
  | 'ai-tools-basic-response'
  | 'ai-tools-standard-response'
  | 'ai-tools-premium-response'
  | 'ai-tools-basic-tokens'
  | 'ai-tools-standard-tokens'
  | 'ai-tools-premium-tokens'
  | 'content-processing-page'
  | 'voice-classic-minute'
  | 'voice-genai-minute'
  | 'voice-premium-genai-minute'
  | 'retrieval-api-query'
  | 'cowork-task'
  | 'github-ai-credit';

export interface RateCard {
  version: string;
  effectiveDate: string;
  currency: string;
  title: string;
  disclaimer: string;
  changelog: { version: string; date: string; summary: string }[];
  consumption: Record<ConsumptionRateId, ConsumptionRate>;
  creditCurrencies: Record<CreditCurrencyId, CreditCurrency>;
  commercial: {
    paygCreditUsd: SimpleCommercialRate;
    capacityPack: CapacityPackRate;
    m365CopilotSeatMonthlyUsd: SimpleCommercialRate;
    securityCopilot: SecurityCopilotRate;
    githubCopilot: GithubCopilotRate;
    foundry: FoundryRate;
  };
  p3PrePurchasePlan: P3Plan;
  maccEligibility: MaccEligibility;
  modelAssumptions: ModelAssumptions;
}

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */

export type AuditValue = number | string | boolean;

export interface AuditEntry {
  step: string;
  formula: string;
  inputs: Record<string, AuditValue>;
  output: number;
  outputUnit: string;
  rateCardRef: string | null;
}

/* ------------------------------------------------------------------ */
/* Normalised answers                                                  */
/* ------------------------------------------------------------------ */

export interface NormalisedAnswers {
  answers: Answers;
  /** Workloads that were selected AND have usable usage data. */
  activeWorkloads: WorkloadId[];
  /** Workloads selected but left at defaults (used for transparency messaging). */
  defaultedWorkloads: WorkloadId[];
  seasonality: SeasonalityProfile;
  peakMonthMultiplier: number;
  /** 1-based month index (1..12) that carries the seasonal spike. */
  peakMonth: number;
  /** Distinct internal users touching metered agent workloads (max-overlap assumption). */
  internalUsers: number;
  /** Weighted share (0..1) of those internal users holding a Microsoft 365 Copilot licence. */
  internalLicensedShare: number;
  /** Adoption ramp factor for months 1..12 (0..1+). */
  rampFactors: number[];
  /** Seasonality factor for months 1..12. */
  seasonalityFactors: number[];
  confidence: ConfidenceLevel;
}

/* ------------------------------------------------------------------ */
/* Volume + credit model                                               */
/* ------------------------------------------------------------------ */

export interface VolumeLine {
  workloadId: WorkloadId;
  lineId: string;
  label: string;
  /** Volume in the rate's own unit, per month at steady state. */
  quantity: number;
  unit: string;
  rateId: ConsumptionRateId;
  /** Share (0..1) of this line's volume generated by internal users. */
  internalShare: number;
  /** Share (0..1) of those internal users who hold a Microsoft 365 Copilot licence. */
  licensedShareOfInternal: number;
}

export interface VolumeModel {
  lines: VolumeLine[];
  totalsByWorkload: Record<string, number>;
}

export interface CreditLine extends VolumeLine {
  creditsPerUnit: number;
  /** Which meter these credits are billed against. */
  currency: CreditCurrencyId;
  grossCredits: number;
  offsetEligible: boolean;
  offsetShare: number;
  offsetCredits: number;
  billableCredits: number;
}

export interface CurrencyTotals {
  currency: CreditCurrencyId;
  label: string;
  meter: string;
  unitUsd: number;
  grossCredits: number;
  offsetCredits: number;
  billableCredits: number;
  billableCostUsd: number;
  /** Funding options that can pay for this pool. Empty means "its own meter only". */
  fundableBy: FundingOptionId[];
}

/**
 * Every scalar total on this model is scoped to **Microsoft Copilot Credits**, because
 * that is the pool the funding options actually size against. Credits billed on another
 * meter — today only GitHub AI credits — are held in {@link CreditModel.byCurrency} and
 * costed separately, so no Microsoft funding vehicle can be offered against them.
 */
export interface CreditModel {
  lines: CreditLine[];
  grossCredits: number;
  offsetCredits: number;
  billableCredits: number;
  internalBillableCredits: number;
  externalBillableCredits: number;
  /** Credits that would be zero-rated if every internal user held a licence. */
  offsettableRemainingCredits: number;
  byWorkload: { workloadId: WorkloadId; grossCredits: number; billableCredits: number }[];
  /** Per-meter totals, including the Microsoft pool above. */
  byCurrency: CurrencyTotals[];
  /** Billable credits on meters other than Microsoft's, and what they cost there. */
  otherMeterBillableCredits: number;
  otherMeterCostUsd: number;
}

export interface CreditModelOptions {
  /** Treat every internal user as licensed (models the licence-shift strategy). */
  assumeAllInternalLicensed?: boolean;
  /** Zero-rate generative answers because the model is served from Foundry (BYOM). */
  byomZeroRateGenerative?: boolean;
}

/* ------------------------------------------------------------------ */
/* Cost model                                                          */
/* ------------------------------------------------------------------ */

export interface PlatformCostLine {
  id: string;
  label: string;
  monthlyUsd: number;
  annualUsd: number;
  rateCardRef: string;
  note?: string;
}

export interface CostModel {
  billableCredits: number;
  meteredCreditCostUsd: number;
  platformLines: PlatformCostLine[];
  platformMonthlyUsd: number;
  platformAnnualUsd: number;
  totalMonthlyUsd: number;
  effectiveUsdPerCredit: number;
  /** Additional M365 Copilot seats required to fully zero-rate internal traffic. */
  m365CopilotSeatsHeld: number;
}

/* ------------------------------------------------------------------ */
/* Scenario bands + monthly projection                                 */
/* ------------------------------------------------------------------ */

export type BandName = 'conservative' | 'expected' | 'aggressive';

export interface ScenarioBand {
  name: BandName;
  multiplier: number;
  monthlyCredits: number;
  annualCredits: number;
  monthlyCreditCostUsd: number;
  annualCreditCostUsd: number;
}

export interface MonthlyPoint {
  month: number;
  label: string;
  rampFactor: number;
  seasonalityFactor: number;
  conservativeCredits: number;
  expectedCredits: number;
  aggressiveCredits: number;
}

export interface ScenarioModel {
  bands: Record<BandName, ScenarioBand>;
  months: MonthlyPoint[];
  expectedMonthlyCredits: number[];
  conservativeMonthlyCredits: number[];
  aggressiveMonthlyCredits: number[];
  meanMonthlyCredits: number;
  stdDevMonthlyCredits: number;
  coefficientOfVariation: number;
  peakMonthCredits: number;
  peakMonthIndex: number;
}

/* ------------------------------------------------------------------ */
/* Licence break-even                                                  */
/* ------------------------------------------------------------------ */

export interface LicenceBreakEven {
  seatMonthlyUsd: number;
  breakEvenCreditsAtPayg: number;
  breakEvenCreditsAtPackRate: number;
  internalUsers: number;
  licensedInternalUsers: number;
  unlicensedInternalUsers: number;
  creditsPerUnlicensedInternalUserPerMonth: number;
  shareOfUsersAboveBreakEvenPct: number;
  /** Count of unlicensed internal users whose own consumption clears the seat price. */
  usersAboveBreakEven: number;
  /** Credits a month carried by those users — the volume a targeted licence shift removes. */
  creditsRemovedByTargetedShift: number;
  monthlyMeteredSpendRemovedUsd: number;
  annualMeteredSpendRemovedUsd: number;
  annualSeatCostUsd: number;
  annualNetBenefitUsd: number;
  worthwhile: boolean;
  externalCreditsNeverOffsettable: number;
  externalMonthlyCostUsd: number;
  narrative: string;
}

/* ------------------------------------------------------------------ */
/* Funding options                                                     */
/* ------------------------------------------------------------------ */

export type FundingOptionId =
  | 'payg'
  | 'packs-only'
  | 'packs-plus-payg'
  | 'p3-plus-payg'
  | 'p3-packs-payg'
  | 'licence-shift'
  | 'byom-foundry'
  | 'do-nothing';

export type CashFlowShape = 'monthly-variable' | 'monthly-fixed' | 'annual-upfront' | 'hybrid' | 'none';
export type Reversibility = 'immediate' | 'monthly' | 'annual-locked' | 'n/a';

export interface FundingBreakdownRow {
  label: string;
  annualUsd: number;
  note?: string;
}

export interface FundingOption {
  id: FundingOptionId;
  label: string;
  summary: string;
  twelveMonthTotalUsd: number;
  creditFundingUsd: number;
  platformCostUsd: number;
  peakMonthUsd: number;
  effectiveUsdPerCredit: number;
  creditsServed: number;
  purchasedCredits: number;
  wasteCredits: number;
  wasteUsd: number;
  wastePctOfPurchased: number;
  shortfallCredits: number;
  shortfallRiskPct: number;
  cashFlowShape: CashFlowShape;
  commitmentLockInMonths: number;
  maccEligibility: MaccEligibilityValue;
  /** Credit currencies this option is actually able to fund. */
  fundsCurrencies: CreditCurrencyId[];
  reversibility: Reversibility;
  bestWhen: string;
  avoidWhen: string;
  breakdown: FundingBreakdownRow[];
  eligible: boolean;
  ineligibleReasons: string[];
  monthlyUsd: number[];
  meta?: Record<string, AuditValue>;
}

/* ------------------------------------------------------------------ */
/* Recommendation                                                      */
/* ------------------------------------------------------------------ */

export type RuleId =
  | 'volatility'
  | 'waste'
  | 'commit'
  | 'macc'
  | 'licence'
  | 'governance'
  | 'safety-net';

export interface RuleOutcome {
  id: RuleId;
  name: string;
  fired: boolean;
  reason: string;
  effect: string;
  evidence: Record<string, AuditValue>;
}

export interface RankedOption {
  optionId: FundingOptionId;
  label: string;
  twelveMonthTotalUsd: number;
  deltaVsPrimaryUsd: number;
  tradeOff: string;
  /**
   * Economic score: the 12-month total weighted by the recommendation rules. Always
   * finite, so the result survives JSON serialisation intact. Disqualified options keep
   * their real score and are ranked last via `blocked` rather than by a sentinel value.
   */
  score: number;
  /** True when a rule or an eligibility check rules this option out entirely. */
  blocked: boolean;
}

export interface Recommendation {
  primary: RankedOption;
  alternatives: RankedOption[];
  ranked: RankedOption[];
  headline: string;
  confidenceChip: 'Low' | 'Medium' | 'High';
  annualSavingVsNaivePaygUsd: number;
  rules: RuleOutcome[];
  governanceActions: string[];
  safetyNet: string | null;
  /**
   * True when there is no Microsoft Copilot Credit demand to fund, so no funding
   * instrument in this model changes anything and every option costs the same.
   *
   * This is an explicit outcome rather than a tie. Left to the sort, equal scores
   * resolved on declaration order and pay-as-you-go won by accident — headlining a
   * GitHub seat bill as something a Microsoft credit meter should fund, when that meter
   * would fund none of it.
   */
  noDecisionRequired: boolean;
}

/* ------------------------------------------------------------------ */
/* Sensitivity + risk                                                  */
/* ------------------------------------------------------------------ */

export interface SensitivityItem {
  inputId: string;
  label: string;
  baselineValue: number;
  lowValue: number;
  highValue: number;
  lowTotalUsd: number;
  highTotalUsd: number;
  baselineTotalUsd: number;
  swingUsd: number;
  swingPct: number;
}

export type RiskSeverity = 'low' | 'medium' | 'high';

export interface RiskItem {
  id: string;
  title: string;
  severity: RiskSeverity;
  description: string;
  mitigation: string;
}

/* ------------------------------------------------------------------ */
/* Engine result                                                       */
/* ------------------------------------------------------------------ */

export interface EngineResult {
  rateCardVersion: string;
  rateCardEffectiveDate: string;
  currency: string;
  normalised: NormalisedAnswers;
  volume: VolumeModel;
  credits: CreditModel;
  cost: CostModel;
  scenario: ScenarioModel;
  licenceBreakEven: LicenceBreakEven;
  fundingOptions: FundingOption[];
  recommendation: Recommendation;
  sensitivity: SensitivityItem[];
  risks: RiskItem[];
  audit: AuditEntry[];
}
