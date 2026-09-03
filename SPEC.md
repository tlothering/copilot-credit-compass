# BUILD PROMPT — "Copilot Credit Compass" (AI Credit Estimator & Funding Advisor)

> Paste everything below into your coding agent. It is written to be self-contained.

---

## 0. ROLE

You are a senior full-stack engineer, cloud architect and product designer. Build a
production-grade, publicly hosted web application called **Copilot Credit Compass**.
Ship working code, IaC, CI/CD and a one-click **Deploy to Azure** button. Do not stub
anything you can implement. Where you must make a judgement call, choose the option and
document it in `DECISIONS.md`.

---

## 1. MISSION

Enterprise customers cannot answer three questions:

1. *How many Microsoft Copilot credits will we actually consume?*
2. *What will that cost?*
3. *How should we fund it — prepaid capacity packs, pay-as-you-go, or an annual Azure
   pre-purchase commitment (P3) / Azure commitment burn-down?*

Copilot Credit Compass answers all three via a **wizard-driven questionnaire**, produces a
**deterministic cost model**, generates an **executive- and CTO-ready exportable report**,
and contributes each anonymous result to a **public benchmark dashboard** so other
organisations can sanity-check their own assumptions against their industry peers.

**Non-goals:** it is not a billing system, not a Microsoft product, and must never claim to
be authoritative pricing. It is a planning and negotiation-preparation tool.

---

## 2. HARD CONSTRAINTS

| # | Constraint |
| --- | --- |
| C1 | **Zero PII.** Never collect or persist name, email, company name, tenant ID, domain, IP address, or any free-text that could identify a person or organisation. No auth, no accounts, no cookies beyond a strictly-necessary theme preference. |
| C2 | **Ephemeral session.** All in-progress wizard state lives in browser memory (+ `sessionStorage` for refresh resilience only). Persist a **prominent, dismissible-but-recurring warning**: *"Your answers are held only in this browser session. Closing or refreshing this tab will permanently discard them. Export your report before you leave."* Also fire a `beforeunload` guard once the user has answered ≥1 question. |
| C3 | **Anonymous public benchmark.** On (and only on) explicit user consent at the end of the wizard, POST a de-identified result record to the backend. It joins a public, unauthenticated dashboard. Show the user the exact JSON that will be submitted before they consent. |
| C4 | **Usage counter.** Track total app runs, completed calculations, and exports. Aggregate counters only. |
| C5 | **Deploy to Azure.** A working `azuredeploy.json` (ARM, compiled from Bicep) plus a README badge that provisions the entire stack in one click. |
| C6 | **Rate card is data, not code.** All prices and consumption rates live in a versioned JSON rate card with an `effectiveDate`, `sourceUrl` per line item, and a `currency`. Rates change frequently — the app must be updatable without a code change. |
| C7 | **Modern design.** 2026-era visual language (spec in §9). WCAG 2.2 AA minimum. |

---

## 3. TECH STACK

- **Framework:** Next.js 15+ (App Router, React 19, Server Components where sensible), TypeScript strict.
- **Styling:** Tailwind CSS v4 (CSS-first config, OKLCH colour space) + shadcn/ui primitives (Radix under the hood).
- **Motion:** Motion (Framer Motion v11+) with spring physics; native View Transitions API for wizard step changes; full `prefers-reduced-motion` support.
- **Charts:** Recharts or visx — themed, animated, accessible (every chart has a screen-reader table fallback).
- **Forms/validation:** React Hook Form + Zod. Zod schemas are the single source of truth, shared client/server.
- **State:** Zustand for wizard state (memory-first, `sessionStorage` mirror).
- **Backend:** Next.js Route Handlers (`/api/*`) — no separate service.
- **Data:** Azure Cosmos DB for NoSQL, **serverless** tier. Two containers: `submissions` (partition key `/industryRegionKey`) and `counters` (partition key `/id`). Connect with **Managed Identity + RBAC**, never a connection string in app settings.
- **Export:** Server-side PDF generation (`@react-pdf/renderer` — deterministic, no headless Chromium needed); XLSX via `exceljs`; PPTX via `pptxgenjs`.
- **Hosting:** Azure Container Apps (consumption plan, scale-to-zero) running a distroless Node image. Provide Azure Static Web Apps as a documented alternative in `DECISIONS.md`.
- **Observability:** Azure Application Insights (OpenTelemetry). **Disable IP collection and all PII telemetry** (`disableIpMasking: false`, strip `client_IP`).
- **CI/CD:** GitHub Actions — lint → typecheck → unit test → build image → push to GHCR → deploy to ACA via OIDC federated credentials (no secrets).
- **Testing:** Vitest for the calculation engine (this is the highest-risk code — aim for 100% branch coverage on `lib/engine/*`), Playwright for the wizard happy path + export.

---

## 4. INFORMATION ARCHITECTURE

```
/                     Landing — value prop, live benchmark ticker, "Start assessment" CTA
/assess               The wizard (steps are URL-addressable: /assess/[step])
/results              Results dashboard for the current session (in-memory only)
/benchmark            Public anonymous benchmark dashboard
/methodology          Full transparency: rate card, formulas, assumptions, changelog
/privacy              What we do and do not collect (plain English)
```

---

## 5. THE WIZARD

Design it as a calm, one-question-cluster-per-screen flow. Persistent progress rail,
back/forward, "Skip — use industry default" on every question, and a live **running
estimate** pinned to the side that updates as they answer. Every question has an
info-popover explaining *why we ask* and *how it affects cost*.

### Step 0 — Welcome & Data Notice
Explain the session-loss warning (C2), the anonymous benchmark, and estimated time (~6 min).

### Step 1 — Organisation Profile *(shape only — never identity)*
- **Industry** (single select, from a fixed taxonomy: Financial Services, Healthcare & Life Sciences, Public Sector, Manufacturing, Retail & CPG, Energy & Utilities, Professional Services, Education, Technology & Software, Telecommunications, Transport & Logistics, Non-profit, Other).
- **Region** (coarse: NA, LATAM, UK&I, Western Europe, Nordics, CEE, MEA, India, Japan, ANZ, ASEAN, Greater China).
- **Total employees** (banded: 1–50, 51–250, 251–1k, 1k–5k, 5k–25k, 25k–100k, 100k+).
- **Knowledge workers in scope** (number).
- **Cloud posture:** Do you have an existing Azure agreement? (None / PAYG / Enterprise Agreement or MCA / MACC — Azure consumption commitment). If MACC: remaining commitment band and months remaining.
- **Current M365 base:** (Business Basic/Standard/Premium, E1, E3, E5, F-series, Mixed, GCC/GCC-High).

### Step 2 — Workload Selection
Multi-select card grid. Every subsequent step is conditionally rendered from this.
Cover **all** Copilot workloads:

1. **Microsoft 365 Copilot** (per-user licence)
2. **Microsoft 365 Copilot Chat** (agents, metered)
3. **Copilot Studio — custom agents** (classic + generative + autonomous)
4. **Copilot Studio — agent flows / automation**
5. **SharePoint agents**
6. **Copilot voice agents** (contact centre / IVR)
7. **AI tools / AI Builder** (text & generative, content processing / document extraction)
8. **Dynamics 365 out-of-box agents** (Sales, Service, Finance, Supply Chain)
9. **Role-based Copilots** (Sales, Service, Finance)
10. **Microsoft Security Copilot** (SCU-metered)
11. **GitHub Copilot** (Business / Enterprise, premium requests & AI credits)
12. **Copilot Cowork / Work IQ API** (usage-based Copilot Credits)
13. **Microsoft Foundry / bring-your-own-model (BYOM)** (billed separately as Azure AI tokens/PTU)
14. **Microsoft 365 Copilot Retrieval API** (preview, metered)

### Step 3 — Per-Workload Usage Interview *(dynamic)*

For **each** selected workload ask sizing questions in business language, never in credits.
Examples:

**Copilot Studio custom agents**
- How many distinct agents will you run in production? (now / in 12 months)
- Who uses them: internal employees, external customers, or both?
- Of your internal users, how many hold a Microsoft 365 Copilot licence? *(critical — see §6.3)*
- Average conversations per agent per business day.
- Average turns (messages) per conversation.
- What proportion of turns are: scripted/classic answers vs. generative (LLM) answers vs. actions that call a system of record? (three sliders summing to 100%)
- Do agents ground on tenant Microsoft Graph data? If so, what % of turns?
- Does the agent trigger automation flows? Average flow actions per conversation.
- Business days per month (default 21) and seasonality profile (Flat / Business-hours peak / Seasonal spike — with peak month multiplier).

**Voice agents**
- Calls per day, average handle time (minutes), voice tier (Classic / GenAI / Premium GenAI), containment rate.

**AI tools / document processing**
- Documents processed per month, average pages per document, model tier (basic / standard / premium), tokens per response.

**Security Copilot**
- SOC analysts, investigations per day, average SCU-minutes per investigation, 24×7 or business hours, embedded vs. standalone experiences.

**GitHub Copilot**
- Developer seats, plan tier, % who are heavy agent/code-review users, preferred model tier (economy / standard / premium).

**Microsoft 365 Copilot**
- Seats now, seats at 12 months, ramp curve (Big bang / Phased quarterly / Pilot-then-scale).

### Step 4 — Growth, Risk & Governance
- Adoption ramp: what % of the estimated volume is realistic in month 1, 3, 6, 12?
- Confidence in your own estimates (Low / Medium / High) → drives the width of the scenario band.
- Budget tolerance: Is a surprise overage acceptable? (Never / Tolerable / Irrelevant)
- Do you need cost attribution per business unit? (drives billing-policy recommendation)
- Procurement cycle: can you commit annually? Do you have unspent Azure commitment to burn down?

### Step 5 — Review & Consent
Show a summary of every answer (editable inline), then the **exact anonymised JSON payload**,
then two explicit toggles:
- ☐ Contribute my anonymous results to the public benchmark (default: **off**)
- ☐ I understand this is a planning estimate, not a Microsoft quote

---

## 6. CALCULATION ENGINE

Put this in `lib/engine/`. Pure, deterministic, side-effect-free functions. Fully unit tested.
Every intermediate value must be traceable — the engine returns not just numbers but an
**audit trail** array of `{ step, formula, inputs, output, rateCardRef }` so the methodology
page and the PDF can show the working.

### 6.1 Core flow

```
answers → normalise → volumeModel → creditModel → costModel
        → scenarioBand(low/expected/high) → fundingOptions[]
        → recommendation → report
```

### 6.2 Rate card (seed data — `data/rate-card.v1.json`)

> Ship these as the seed values. Mark `verified: true` for Microsoft-Learn-sourced rows and
> `verified: false` for market-observed rows. Display the `effectiveDate` in the UI.

**Copilot Credit consumption rates** *(source: Microsoft Learn — Copilot Studio "Billing rates and management")*

| Agent feature | Copilot Credits | Charged for a Microsoft 365 Copilot–licensed user? |
| --- | --- | --- |
| Classic answer | 1 | **No charge** |
| Generative answer | 2 | **No charge** |
| Agent action | 5 | **No charge** |
| Tenant graph grounding (per message) | 10 | **No charge** |
| Agent flow actions (per 100 actions) | 13 | **No charge** |
| Text & generative AI tools — **basic** | 1 per 10 responses (0.1 per 1K tokens) | No charge |
| Text & generative AI tools — **standard** | 15 per 10 responses (1.5 per 1K tokens) | No charge |
| Text & generative AI tools — **premium** | 100 per 10 responses (10 per 1K tokens) | No charge |
| Content processing tools | 8 per page/image | No charge |
| Voice — Classic (classic orchestration) | 10 / minute | Core activity included |
| Voice — GenAI | 35 / minute | Core activity included |
| Voice — Premium GenAI | 75 / minute | Core activity included |

**Commercial rates**

| Item | Value | Notes |
| --- | --- | --- |
| Pay-as-you-go Copilot Credit | **$0.01 / credit** | Azure meter, billed to an Azure subscription. Also the meter for M365 Copilot Chat agents and SharePoint agents. |
| Copilot Studio prepaid capacity pack | **$200 / month for 25,000 credits** ($0.008/credit) | Tenant-level pool. **Unused capacity does NOT roll over** — resets on the 1st of each month. |
| Copilot Credit Pre-Purchase Plan (**P3**) | Tiered CCCU commit, 1-year term | Bought as an Azure *reservation*. More you buy, bigger the discount. Learn's worked example: 15,000 CU tier ≈ 6% saving; higher tiers trend toward ~20%. Auto-renews by default. |
| Microsoft 365 Copilot | ~$30 / user / month (annual commit) | Add-on to a qualifying M365 base plan. |
| Security Copilot | ~$4 / SCU / hour provisioned; ~$6 / SCU / hour overage | Minimum 1 SCU. |
| GitHub Copilot Business | ~$19 / user / month | Included AI-credit / premium-request allowance; overage ~$0.01 per credit. |
| GitHub Copilot Enterprise | ~$39 / user / month | Larger included allowance. |

**Critical P3 mechanics to encode (all from Microsoft Learn):**
- Purchased CCCUs pay down qualifying Copilot Credit retail cost **in USD, 1 CU ≈ $1 of retail cost**.
- Charged to the subscription's payment method as a **separate invoice line item**. It is **not** deducted from an Enterprise Agreement's Azure Prepayment / monetary-commitment balance.
- Scope options: resource group / subscription / shared / management group.
- **Cannot be cancelled or exchanged. Cannot be split or merged. All purchases are final.**
- Pre-purchase discounts **do not stack** with other negotiated discounts.
- Overage beyond the plan automatically falls back to pay-as-you-go — no service interruption.

Model MACC eligibility as a **configurable flag with a "verify with your Microsoft account team"** caveat, not as a hard fact — MACC treatment varies by agreement.

### 6.3 The single most valuable calculation — the M365 Copilot licence offset

This is the app's flagship insight and must be front and centre in the report.

> Core agent activity (classic answers, generative answers, agent actions, tenant graph
> grounding, agent flow actions and AI tools) is **not charged** when the consuming user
> holds a Microsoft 365 Copilot licence.

Therefore:

```
billableCredits = Σ over workloads:
    volume(w) × rate(w) × (1 − m365CopilotLicensedShareOfUsers(w))
```

The engine must compute and headline a **Licence Break-Even**:
> *"At your projected volume, a Microsoft 365 Copilot seat pays for itself once a user
> generates more than N credits/month (N = $30 ÷ $0.01 = 3,000 credits, or 3,750 credits
> against pack pricing at $0.008). X% of your modelled internal users cross that line —
> licensing them removes $Y/month of metered spend."*

Also model the inverse trap: external/customer-facing agent traffic can **never** be offset
by licences, so it is always metered — flag this loudly.

### 6.4 Scenario bands
Produce **Conservative / Expected / Aggressive** using multipliers driven by the user's stated
confidence (e.g. Low → 0.6× / 1.0× / 2.0×; High → 0.85× / 1.0× / 1.25×) plus the seasonality
peak multiplier. Show a 12-month month-by-month curve applying the adoption ramp.

### 6.5 Funding options — model **all**, then rank

Compute total 12-month cost, and cost in the peak month, for each of:

1. **Pure pay-as-you-go** (Azure meter)
2. **Prepaid capacity packs only** (integer pack count sized to expected demand; model the *shortfall risk* — service stops when credits are exhausted with no PAYG policy)
3. **Packs + PAYG overage policy** (recommended default hybrid — buy packs to the P25–P50 of demand, meter the tail)
4. **P3 annual pre-purchase plan** (+ PAYG overflow), at each discount tier
5. **P3 + packs + PAYG** (three-tier waterfall)
6. **Licence-shift strategy** (buy M365 Copilot seats to zero-rate internal consumption, meter only external traffic)
7. **BYOM via Microsoft Foundry** (agent action credit only + separate Azure token/PTU cost) — for high-token workloads
8. **Do nothing / defer** (baseline)

For each option output: 12-month total, effective $/credit, waste (unused prepaid), shortfall
risk %, cash-flow shape, commitment lock-in, MACC burn-down eligibility, reversibility, and
a plain-English "best when…" / "avoid when…".

### 6.6 Recommendation rules (encode explicitly, show the reasoning)

- **Volatility test:** if `stdDev(monthlyCredits)/mean > 0.35` → weight toward PAYG, cap packs at the P25 of demand.
- **Waste test:** never recommend packs whose 12-month unused credits exceed 15% of purchased credits (packs don't roll over).
- **Commit test:** recommend P3 only when (a) 12 rolling months of forecast credits ≥ the tier threshold **at the Conservative band**, and (b) the user said they can commit annually. Never recommend P3 on Low confidence — it is non-cancellable and non-exchangeable.
- **MACC test:** if unspent Azure commitment exists and is expiring, surface PAYG/P3 as commitment burn-down — but always with the "confirm eligibility with your account team" caveat.
- **Licence test:** if internal-user credits/user/month > break-even, recommend the licence shift first, then size the remaining funding on the residual external traffic only.
- **Governance test:** if cost attribution per BU is required, recommend multiple billing policies / environment-scoped credit policies.
- **Safety net:** always recommend a PAYG overage policy alongside any prepaid option unless the user explicitly said a hard stop is acceptable.

Output a **primary recommendation** plus **two credible alternatives**, each with an explicit
trade-off statement and the dollar delta versus the primary. Never present a single option
without alternatives.

---

## 7. RESULTS DASHBOARD (`/results`)

Bento-grid layout:
- **Hero KPI band:** estimated monthly credits, monthly cost (Expected, with the Low–High band as a subtitle), 12-month total, effective $/credit.
- **Recommendation card** — the headline funding strategy in one sentence, with a confidence chip and the annual saving vs. naive PAYG.
- **Waterfall chart:** gross credits → licence offset → billable credits → prepaid absorption → metered tail.
- **12-month stacked area:** packs vs. P3 vs. PAYG overage.
- **Funding comparison table:** all 8 options, sortable, with the recommended row highlighted.
- **Workload treemap:** where the credits actually go.
- **Sensitivity tornado:** which 5 inputs move the cost most (auto-computed by ±20% perturbation).
- **Break-even card:** the licence-offset insight.
- **Risk register:** shortfall risk, non-cancellable commitment, external-traffic exposure, rate-change exposure.
- **"How does this compare?"** — live percentile placement against the anonymous benchmark for the same industry + size band (only shown when n ≥ 5 in that cohort).
- Sticky **Export** and **Restart** actions, plus the persistent session-loss warning.

---

## 8. PUBLIC BENCHMARK

### 8.1 Submitted record schema (this and nothing more)

```jsonc
{
  "id": "uuid-v4",                 // generated server-side
  "submittedAt": "2026-01-15T00:00:00Z", // truncated to the hour
  "rateCardVersion": "v1",
  "industry": "Financial Services",
  "region": "UK&I",
  "employeeBand": "5k-25k",
  "knowledgeWorkerBand": "1k-5k",
  "workloads": ["copilot-studio", "m365-copilot", "sharepoint-agents"],
  "agentCount": 12,
  "monthlyCreditsExpected": 412000,
  "monthlyCostExpectedUsd": 3296,
  "creditsPerKnowledgeWorkerPerMonth": 137,
  "m365CopilotLicensedSharePct": 40,
  "mixClassicPct": 30, "mixGenerativePct": 55, "mixActionPct": 15,
  "graphGroundingPct": 20,
  "recommendedStrategy": "packs-plus-payg",
  "estimatedAnnualSavingVsPaygUsd": 4800
}
```

### 8.2 Anti-abuse & privacy hardening
- **k-anonymity:** never render a cohort with fewer than **5** submissions; roll up to a broader band instead.
- Round/bucket all money and credit figures before display.
- Reject implausible outliers server-side (e.g. > 500M credits/month) and exclude them from percentiles.
- Rate-limit submissions per IP **without storing the IP** (hash it with a rotating daily salt held in memory/Redis, TTL 24h).
- Optional Cloudflare Turnstile / Azure-native bot protection on the submit endpoint.
- No `X-Forwarded-For` persisted anywhere. App Insights IP masking enforced.

### 8.3 Dashboard (`/benchmark`)
- Headline counters: assessments completed, calculations run, reports exported, organisations contributing.
- Filterable by industry / region / size band.
- **Credits per knowledge worker per month** — the single most useful comparative metric — shown as a distribution with P25/P50/P75/P90 and the viewer's own position if they have a session result.
- Workload adoption frequency, typical answer-mix, average agent count by industry, most-recommended funding strategy by industry.
- Explicit "n = X, last updated Y" on every visual, and an honest limitations note: self-reported, self-selected, non-representative.
- Downloadable aggregated CSV (aggregates only, never raw rows).

---

## 9. DESIGN SYSTEM (2026 web trends)

- **Dark-first**, with a genuinely designed light theme (not an inversion). Respect `prefers-color-scheme`, allow manual override.
- **OKLCH** colour tokens for perceptually uniform ramps. Base neutral is a slightly warm near-black; a single vivid accent (electric indigo/violet) plus semantic success/warn/risk.
- **Bento-grid** dashboard composition with varied card spans.
- **Restrained glassmorphism** — frosted surfaces only for overlays and the sticky estimate rail; never for body text.
- **Gradient mesh** hero with a subtle animated noise/grain overlay; static fallback under `prefers-reduced-motion`.
- **Typography:** a variable sans (Geist or Inter Variable) with optical sizing; tabular figures on every number; a mono face for credit values. Fluid type scale with `clamp()`.
- **Motion:** spring physics, 150–300 ms, staggered card reveals, animated number counters, scroll-linked progress. Native **View Transitions** between wizard steps.
- **Micro-interactions:** magnetic buttons, hover elevation, satisfying toggle/slider haptics-in-pixels, optimistic loading skeletons that match final layout (no CLS).
- **Container queries** for card-level responsiveness; genuinely good mobile wizard (one input per viewport, thumb-reachable controls).
- **Accessibility is non-negotiable:** full keyboard path through the wizard, visible focus rings, `aria-live` on the running estimate, chart data available as a real `<table>`, 4.5:1 contrast minimum, respects reduced motion and forced colours.

---

## 10. EXPORT — EXECUTIVE & CTO READY

Two audiences, one document, cleanly separated. Generate **PDF** (primary), **XLSX** (the
model), and **PPTX** (a 6-slide board deck). Branded cover, page numbers, generation
timestamp, rate card version, and a footer disclaimer on every page.

**PDF structure:**
1. **Cover** — "Microsoft Copilot Credit & Funding Assessment", industry, size band, date, rate card version.
2. **Executive Summary (1 page, CFO/CEO lens)** — the recommendation in one sentence; 12-month cost with the Low–High band; annual saving vs. naive PAYG; commitment being asked for; three bullet risks; a single decision to approve. No jargon, no credits — dollars and business outcomes only.
3. **Recommendation & Rationale** — primary + two alternatives, trade-off table, the explicit decision criteria that fired.
4. **Financial Model** — 12-month cash-flow table, waterfall, scenario band chart, effective $/credit by option, sensitivity tornado.
5. **Technical Appendix (CTO lens)** — full assumption register, per-workload volume→credit derivation with formulas, the licence-offset arithmetic, the rate card used with source URLs, and the complete audit trail from §6.
6. **Implementation Roadmap** — 30/60/90-day actions: enable billing policies, set environment credit policies and capacity notifications, instrument Power Platform admin centre consumption reporting, define the licence-shift cohort, set an Azure budget + alert, schedule a 90-day true-up.
7. **Risk & Governance Register** — shortfall risk, non-cancellable P3 exposure, monthly pack expiry waste, external-traffic exposure, rate-change exposure, tenant-vs-environment allocation.
8. **Negotiation Brief** — questions to put to the Microsoft account team (MACC eligibility, P3 tier pricing in local currency, discount-stacking treatment, ramp concessions).
9. **Benchmark Context** — where this organisation sits versus its industry cohort.
10. **Disclaimer & Methodology.**

**XLSX:** one sheet per section — `Inputs`, `RateCard`, `VolumeModel`, `CreditModel`, `FundingOptions`, `12MonthCashflow`, `Sensitivity`, `AuditTrail`. **Live formulas, not hard-coded values**, so a CFO can change an assumption and watch it recalculate.

---

## 11. AZURE INFRASTRUCTURE

`infra/main.bicep` provisioning:
- Resource group scoped deployment
- Log Analytics workspace + Application Insights (IP masking on)
- User-assigned Managed Identity
- Cosmos DB for NoSQL, **serverless**, with `submissions` and `counters` containers; RBAC data-plane role assigned to the MI; local auth **disabled**
- Container Apps Environment + Container App (min replicas 0, max 5, HTTP scale rule), image parameterised
- Optional Azure Front Door / WAF toggle
- Diagnostic settings wired to Log Analytics
- All secrets via MI — **zero connection strings in app settings**

Compile to `azuredeploy.json` at the repo root with `createUiDefinition.json` for a clean
portal experience, and add the badge to `README.md`:

```markdown
[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/<url-encoded-raw-github-url-to-azuredeploy.json>)
```

Include a `make deploy` / `azd up` path as well (`azure.yaml` + `infra/`) for developers who
prefer the Azure Developer CLI.

---

## 12. LEGAL / TRUST COPY (write these properly, do not use lorem ipsum)

- **Persistent session banner:** *"Nothing you enter is saved to a server. Your assessment lives only in this browser tab — closing or refreshing it will permanently discard your answers. Export your report before you leave."*
- **Pricing disclaimer (footer + every export page):** *"Copilot Credit Compass is an independent planning tool. It is not affiliated with, endorsed by, or a pricing quotation from Microsoft. Rates shown are from the rate card version stated and change without notice. Confirm all commercial terms — including capacity pack pricing, pre-purchase plan tiers, and Azure consumption commitment eligibility — with your Microsoft account team or partner before purchasing."*
- **Benchmark consent:** show the literal JSON, explain k-anonymity, state that contribution is optional and that results are identical either way.

---

## 13. ACCEPTANCE CRITERIA

1. A user completes the wizard end-to-end in under 8 minutes and receives a recommendation with reasoning.
2. The engine has ≥95% branch coverage and every published number is reproducible from the audit trail.
3. All 8 funding options are always computed and displayed, ranked, with trade-offs.
4. The M365 Copilot licence-offset break-even is calculated and prominently surfaced.
5. Zero PII is collected — verifiable by inspecting the submission payload and the Cosmos documents.
6. Closing the tab loses the data, and the user was warned at least twice before that point.
7. The benchmark dashboard refuses to render any cohort with n < 5.
8. PDF, XLSX and PPTX all export successfully and the XLSX recalculates when an input cell changes.
9. The **Deploy to Azure** button provisions a working instance from a clean subscription with no manual post-steps beyond image availability.
10. Lighthouse ≥95 across Performance, Accessibility, Best Practices, SEO. Zero axe-core violations on every route.
11. The rate card can be updated by editing one JSON file, and the version is visible in the UI and in every export.

---

## 14. DELIVERABLES

Working repo containing: the Next.js app, `lib/engine` with tests, `data/rate-card.v1.json`,
`infra/` Bicep + compiled `azuredeploy.json` + `createUiDefinition.json`, GitHub Actions
workflows, `README.md` (with the Deploy to Azure badge, architecture diagram and local dev
setup), `DECISIONS.md`, `METHODOLOGY.md`, and `PRIVACY.md`.

Build it. Start with the calculation engine and its tests — everything else depends on it
being right.
