# Decisions

Every judgement call made building Copilot Credit Compass, and why. Where the
specification was silent or ambiguous I picked a direction and recorded it here
rather than leaving it implicit in the code.

Decisions are grouped by the area they affect. The rationale matters more than
the choice: if the reasoning no longer holds, change the decision.

---

## 1. Pricing and the rate card

**1. All rates live in one JSON file, never in TypeScript.**
`data/rate-card.v1.json` is the single source of truth. Microsoft's consumptive
pricing moves, and a tool that requires a developer to update a price is a tool
that will be quietly wrong within a quarter. Updating a rate is a data edit that
a non-engineer can review in a pull request.

**2. An ESLint rule enforces it.**
A convention nobody checks is a convention that erodes. `eslint.config.mjs`
carries a `no-restricted-syntax` rule that fails the build on numeric literals
that look like money inside `lib/engine/**`, `app/**` and `components/**`.
`lib/engine/rate-card.ts` is the one exempt file, because it is the loader.

**3. Every rate row carries `sourceUrl` and `verified`.**
Some published Microsoft rates are firm; others are inferred from documentation
that does not state a number outright. Conflating the two would be dishonest.
`verified: false` rows render with a visible "unverified" chip in the UI and in
every export, so a reader always knows which numbers to check before quoting
them to a CFO.

**4. The rate card is versioned and stamped on every artifact.**
`v1`, effective `2026-01-01`. The version appears on the results page, in the
PDF, in the XLSX and on the PPTX. A spreadsheet that outlives the memory of when
it was produced is worse than no spreadsheet.

**5. A `changelog` array ships inside the rate card itself.**
Not in a separate file that will drift. When you change a rate you add a
changelog entry in the same edit, and `/methodology` renders it.

**6. Model assumptions are data, not constants.**
`businessDaysPerMonth`, `hoursPerMonth`, `packSizingPercentile`,
`volatilityThreshold`, `kAnonymityMinimum`, `outlierMaxMonthlyCredits` all live
in the rate card. These are the knobs most likely to be argued about, so they
must be adjustable without a code change and visible on `/methodology`.

---

## 2. The calculation engine

**7. Pure functions, no side effects, no I/O.**
`lib/engine/*` takes inputs and returns outputs. It does not read the clock,
generate randomness, call the network or touch storage. That is what makes the
engine testable to the standard the specification demands, and what makes the
audit trail trustworthy.

**8. Deterministic pipeline: normalise → volume → credits → cost → scenario →
funding → recommendation.**
Each stage consumes the previous stage's output and nothing else. A reader can
follow one direction through the code. Cross-stage shortcuts would have saved a
few lines and cost the ability to explain any single number.

**9. Every step emits an audit entry.**
`{ step, formula, inputs, output, outputUnit, rateCardRef }`. The specification
asked for an audit trail; the harder decision was making it a *first-class
return value* rather than a debug log. It is rendered in the UI, exported to the
PDF and written into the XLSX. The tool's credibility rests on a sceptical
finance reader being able to reconstruct any figure by hand.

**10. `rateCardRef` is a dotted path into the JSON, not a copy of the value.**
`commercial.paygCreditUsd` rather than `0.01`. A path stays correct when the
rate changes; a copied value silently becomes a lie.

**11. Volume modelling uses business days, not calendar days.**
Agents that support human workflows are idle at weekends. Using 30 calendar days
would overstate consumption by roughly 40% for interactive workloads. The
divisor is in the rate card so it can be argued with.

**12. The coefficient of variation drives the scenario band, not a fixed ±20%.**
An organisation with one predictable workload and one with eight volatile ones
should not get the same uncertainty band. Deriving the band from the input mix
makes the range mean something.

**13. Percentile-based pack sizing rather than sizing to the mean.**
Capacity packs do not roll over. Sizing to the mean guarantees a shortfall half
the time. The engine sizes to `packSizingPercentile` and reports the residual
shortfall risk explicitly, so the trade-off is visible rather than buried.

**14. The licence-offset break-even is computed against two thresholds.**
Pay-as-you-go and capacity-pack effective rates give different break-even points
— cheaper credits raise the bar a licence must clear. Reporting one number would
hide the fact that the answer depends on how you buy credits.

**15. The break-even is expressed as a share of unlicensed users, not just a
credit count.**
"3,000 credits per user per month" is not actionable. "9.1% of your 800
unlicensed users consume more than the break-even" is.

**16. All eight funding options are always evaluated and always shown.**
Including ineligible ones, with reasons. A tool that silently drops options
looks like it is steering you. Showing "P3 pre-purchase — not eligible: you told
us you cannot make an annual commitment" is more useful and more honest than
omitting the row.

**17. "Do nothing" is a real option with a real number.**
It is the baseline every business case is implicitly compared against, so it
should be explicit.

**18. Recommendation rules are explicit and ordered, not a scoring heuristic.**
A weighted score would be easier to write and impossible to explain. The rules
in SPEC §6.6 are implemented as stated so the "why this one" text is generated
from the same logic that picked the winner.

**19. Ties are broken toward reversibility.**
When two options are within noise, the one you can back out of is the better
recommendation for a first commitment.

**20. 95% branch coverage threshold, enforced in `vitest.config.ts`.**
Achieved 95.28% branch, 100% line, 100% function on `lib/engine/**`. The
threshold is in config, not in a README, so the build fails if coverage slips.

**21. Table-driven tests with hand-calculated expected values.**
Tests that assert `toMatchSnapshot()` prove the code did not change. Tests with
independently derived expectations prove the maths is right. The specification
explicitly asked for the latter.

---

## 3. State, forms and the wizard

**22. Zustand memory-first with a sessionStorage mirror.**
Memory is the source of truth; sessionStorage is a convenience so a reload does
not destroy work. sessionStorage rather than localStorage because the promise is
"this lives in this tab", and localStorage would outlive the tab and quietly
break that promise.

**23. Deviation: controlled Zustand fields with Zod at the boundary, not React
Hook Form.**
The specification named React Hook Form + Zod. The wizard needs a live running
estimate that recalculates on every keystroke across steps, which means every
field value has to be in the shared store anyway. Running RHF as well would have
meant two sources of truth synchronised on every change. Zod still validates,
and the same schemas are shared client and server as required. RHF remains a
dependency but is unused — flagged here rather than hidden.

**24. Wizard steps are URL-addressable at `/assess/[step]`.**
As specified. It also means a user can bookmark, share a step, or use the back
button without losing their place.

**25. Forward navigation is gated only where an empty answer is meaningless.**
The single hard gate is "at least one workload". Everything else has a sensible
default. Gating every step would turn a five-minute estimate into a form-filling
exercise.

**26. The `beforeunload` guard only arms once the session is dirty.**
Interrupting someone who has entered nothing is user-hostile. The guard watches
the store's `dirty` flag.

**27. The session-loss warning appears on step 0, before any effort is invested.**
Telling someone their work is ephemeral after they have spent ten minutes on it
is not a warning, it is an apology.

**28. The running estimate is `aria-live="polite"`.**
It changes as you type. A screen-reader user gets the same live feedback a
sighted user does — which is the entire point of the sticky rail.

**28a. Regions follow UN M49, not Microsoft's field taxonomy.**
SPEC §5 seeded the region list with Microsoft commercial area names: NA, LATAM,
UK&I, Western Europe, Nordics, CEE, MEA, India, Japan, ANZ, ASEAN, Greater
China. That list is an artefact of how Microsoft organises its sales
organisation, and several entries are not regions at all — ASEAN is a trade
bloc, India and Japan are countries sitting beside continents, and "Greater
China" is a contested political term. A user outside Microsoft's field had to
guess which bucket they were in, and two users in Lisbon could reasonably pick
differently.

The replacement is the UN M49 sub-region level (UN Statistics Division,
"Standard Country or Area Codes for Statistical Use"), which also underpins
Unicode CLDR territory containment. It is published, stable, politically
neutral, and means the same thing in this benchmark as in any other dataset —
which matters for a tool whose output people are meant to compare against
something.

This is a deliberate divergence from SPEC.md. The spec is left unedited as the
record of what was originally commissioned.

**28b. All seventeen sub-regions ship, including the Pacific ones.**
Melanesia, Micronesia and Polynesia will realistically never see a submission,
and it is tempting to trim them. Trimming is how you end up with a bespoke list
again — the moment you hand-pick, you own the taxonomy and every future
argument about it. The benchmark's roll-up already absorbs thin cohorts by
dropping the region, so the cost of carrying them is a longer `<select>` and
nothing else.

Seventeen flat options is genuinely worse to use than twelve, so `SelectField`
gained `<optgroup>` support and the picker is grouped under the five M49
top-level regions. Grouping is driven by consecutive runs in `REGIONS`, so a
unit test asserts each group forms one contiguous run — a reordering would
otherwise render the same heading twice with no other symptom.

**28c. Legacy region values are migrated on read, not left to fail.**
Both benchmark stores parse with `safeParse` and push only on success, so a
record carrying `UK&I` after the rename would not error — it would silently
disappear from the benchmark, taking the cohort's `n` down with it and
tightening k-anonymity for everyone else in it. The same applies to a browser
holding a cached bundle and to a half-finished session restored from
sessionStorage across the deploy.

So `regionSchema` is a `z.preprocess` over the enum, shared by the answer
schema and the benchmark record schema, backed by an explicit alias map.
Verified against the real thing: 21 stored records written under `UK&I` were
read back, remapped to Northern Europe and regrouped into the correct cohort
with nothing dropped.

Two mappings are lossy and worth stating plainly:

- **MEA** spanned Western Asia *and* both African sub-regions. A stored record
  does not say which, so it resolves to Western Asia and some African
  respondents will have been relabelled. This is a property of the old
  taxonomy, not of the migration — it is the reason for the change.
- **Western Europe** exists in both lists but Microsoft's usually included
  Italy, Spain and Portugal, which M49 places in Southern Europe. The label is
  unchanged, so those records pass straight through. Deliberately not aliased:
  aliasing a currently valid value would shadow real answers from new users.

The Cosmos partition key on existing documents still contains the old region
string. That is immutable and harmless — `buildSummary` recomputes the cohort
key from the record's fields and never reads the stored `cohort`.

---

## 4. Persistence and the benchmark

**29. A store interface with two adapters: Cosmos and a JSON-lines file.**
The file adapter is the default. A fresh clone runs, completes an assessment and
produces exports with no database, no emulator and no Azure account. Requiring
infrastructure to see whether software works is a bad first impression.

**30. `/api/health` reports a failed store as `degraded`, not unhealthy.**
The wizard, the engine, the results dashboard and all three exports work with no
database at all. Only the benchmark needs one. Taking the app out of rotation
because an optional aggregate is unavailable would be the wrong trade.

**31. k-anonymity is enforced at read time, in the aggregation, not at write.**
Records are stored; cohorts below `n = 5` are never *emitted*. Enforcing at
write would mean discarding data that becomes publishable once a fifth
organisation joins the cohort.

**32. A four-level roll-up ladder rather than dropping sparse cohorts.**
A cohort below the floor rolls up to a coarser grouping instead of vanishing.
Vanishing cohorts leak information by their absence and make the benchmark
useless for smaller segments.

**33. Outliers are rejected at `outlierMaxMonthlyCredits`, and the count is
published.**
A single fat-fingered input can move a median. Silently dropping records would
be unaccountable, so `rejectedOutliers` appears in the summary.

**34. IP hashing uses a salt that rotates daily and is never persisted.**
Rate limiting needs to recognise a repeat caller within a window. It does not
need to recognise them tomorrow. A rotating in-memory salt makes yesterday's
hashes permanently unlinkable — the property that actually matters — without
storing an IP anywhere.

**35. Benchmark submission is opt-in and shows the exact payload first.**
Not a description of the payload. The literal JSON, on `/privacy` and at the
point of submission. "Trust us" is not a privacy posture.

---

## 5. Exports

**36. Exports are generated server-side.**
`pptxgenjs` and `exceljs` pull `node:fs` and `node:https` into the client bundle.
They are listed in `serverExternalPackages` and driven through
`app/api/export/[kind]`. This also keeps the client bundle small for a tool
whose first screen should load fast.

**37. The XLSX contains live formulas, not pasted values.**
As specified, and worth restating: the recipient is a finance analyst who will
want to change an assumption. A workbook of hard-coded numbers is a screenshot
with extra steps. Inputs are on their own sheet and every downstream figure
references them.

**38. The PDF is a board pack, the PPTX is six slides, the XLSX is a model.**
Three different readers with three different needs. Producing the same content
in three wrappers would have been less work and less useful.

**39. Legal and caveat copy lives once, in `lib/export/copy.ts`.**
`DISCLAIMER`, `SESSION_BANNER`, `ROADMAP`, `NEGOTIATION_QUESTIONS`. Retyping a
disclaimer per surface is how surfaces end up disagreeing about what the tool
claims.

---

## 6. Design and accessibility

**40. OKLCH throughout.**
Perceptually uniform lightness means a token at 50% L is genuinely mid-tone at
every hue, which is what makes a systematic contrast fix possible rather than a
per-colour guess.

**41. Dark-first with a designed light theme, not an inverted one.**
The light palette has its own warm neutral ramp. Algorithmically inverting a
dark theme produces a light theme that looks like a mistake.

**42. Charts are decorative; the accessible representation is a real table.**
Every chart frame renders a `<table>` with a caption. This is why the Recharts
accessibility layer is disabled — it was injecting a focusable
`role="application"` node inside an `aria-hidden` subtree, which is a keyboard
trap and a serious axe violation.

**43. Accessibility failures were fixed, never asserted away.**
The first axe run found four genuine defects. Each was fixed at the cause:
  - Light `--fg-subtle` measured 4.32:1. Now 50% lightness.
  - Ineligible funding rows were dimmed with `opacity-55`, dropping their text
    to 1.18:1. The reason an option is ruled out is exactly what a reader needs,
    so they now use a recessed surface and an explicit badge.
  - Treemap tiles were a saturated fill with a hard-coded dark label. No single
    label colour clears AA against both a 66-80% lightness palette and a 48-56%
    one, so tiles are now a tint of the sunken surface and the ordinary
    foreground token carries the text.
  - Stat blocks placed a stray `<p>` inside a `<dl>`, breaking list semantics.
    The supporting line is now a second `<dd>`.

**44. Both themes are tested for accessibility.**
Headless Chrome reports a light colour preference, so a single axe pass would
only ever have exercised the light theme. Both ship, so both are asserted.

**45. Motion is opt-out at the system level.**
View Transitions and spring motion sit inside
`@media (prefers-reduced-motion: no-preference)`, and a `reduce` block disables
transitions outright. Motion is a garnish; the tool works without it.

**45a. API response shapes are imported from the producer, never restated.**
The landing ticker shipped with a hand-written local `TickerData` interface
naming four fields — `totalRuns`, `cohorts: number`,
`medianCreditsPerUserPerMonth`, `medianAnnualUsd` — that the aggregate has never
returned. Every tile rendered an em dash on every visit, in both themes, from
the first commit. The type system said nothing, because
`r.json() as Promise<TickerData>` is an *assertion*, not a check: `json()`
returns `any`, and casting it invents a contract rather than verifying one.
There was no second source of truth to disagree with.

Both consumers of `/api/benchmark/summary` now import `BenchmarkSummary` from
`lib/benchmark/aggregate.ts`, so the producer's type is the only definition and
any future field rename is a compile error. The rule generalises: an
`as Promise<T>` on a `fetch().json()` is an unchecked claim, and if `T` is
declared locally it is a latent bug waiting for someone to rename a field.

**45b. The fourth ticker tile shows a strategy, not a median spend.**
The broken tile had asked for `medianAnnualUsd`, which does not exist and was
not simply misnamed — the aggregate publishes no median-spend figure at all.
Computing one from the per-cohort medians would be a median of medians, which
`METHODOLOGY.md` explicitly refuses as unsound. The tile now shows
"Most recommended strategy", which the aggregate genuinely reports and which is
subject to the same k-anonymity withholding as everything else.

**45c. The regression test asserts rendered values, not markup.**
The existing suite stayed green throughout, because a page full of em dashes is
perfectly accessible, perfectly navigable and perfectly exportable. Axe had no
complaint. `tests/e2e/landing.spec.ts` therefore asserts that the ticker
resolves to real figures: no skeletons left spinning, no em dashes, and an
assessment count matching `/^[\d,]+$/`. That last one holds in CI with an empty
store because `headline.assessments` is `0`, not `null`, on a fresh deployment.
The test was confirmed non-vacuous by reintroducing the original field name and
watching two of the three cases fail.

---

## 7. Infrastructure

**46. Managed identity only. The Container App has an empty `secrets` array.**
Cosmos is provisioned with `disableLocalAuth: true`, so no key can be issued at
all — this is stronger than not putting a key in app settings, because there is
no key to put there.

**47. The one remaining platform credential is documented, not hidden.**
The Container Apps managed environment requires
`logAnalytics.listKeys().primarySharedKey` for its log shipper. This is resolved
by ARM at deployment time between two Azure resources and never becomes an
application setting. Calling it out is better than letting a reader find it and
wonder what else was glossed over.

**48. `DisableIpMasking: false` on Application Insights.**
Counter-intuitively, `false` means *mask the IP*. Left at its default it would
retain client IPs, which would break the zero-PII constraint through the back
door.

**49. Cosmos is serverless.**
Traffic is bursty and low-volume. Provisioned throughput would cost more while
idle than the tool costs to run.

**50. The Container App scales to zero.**
Cold starts are acceptable for an assessment tool nobody uses continuously, and
scale-to-zero is the difference between a demo that costs pennies and one that
gets switched off.

**51. `stickySessions.affinity: 'none'`, deliberately.**
Pinning clients to an instance would make the per-instance rate limiter look
stronger than it is. Better to have an honestly approximate limiter than a
falsely precise one.

**52. Front Door and WAF are optional, defaulted off.**
Most evaluators want the cheapest thing that runs. Anyone deploying for real
flips one parameter.

**53. `createUiDefinition.json` applies one flat tag set to all resources.**
The Bicep template takes a flat `tags` parameter, so per-resource tagging in the
portal UI would offer control the template cannot honour. An InfoBox says so.

**54. CI verifies `azuredeploy.json` matches a fresh `az bicep build`.**
Ignoring `metadata._generator`, which carries the compiler version. Without this
check the Deploy to Azure button could ship ARM that nobody reviewed, because
the compiled artifact is what the portal actually executes.

**55. The Docker runtime stage runs as uid 1001 with no package manager and no
source.**
Standalone output only. Smaller image, smaller attack surface.

**56. Deployment uses OIDC federated credentials, and waits for health.**
No secret in the repository can deploy anything. The workflow then blocks until
a revision reports healthy and smoke-tests the live URL, because the deployment
cannot grant the identity access to GHCR — that failure has to surface loudly
rather than as a container stuck pulling an image.

**56a. There is a `.dockerignore`, and it is load-bearing.**
The builder stage runs `COPY . .`. Without exclusions that copies the host
`node_modules` over the Linux tree `npm ci` just installed in the deps stage —
on a Windows or macOS developer machine that means native modules built for the
wrong platform. It also copies `.data/`, which is where the file-store fallback
writes real benchmark submissions. Next.js traces that file at build time into
`.next/standalone/.data/`, and the runtime stage copies `.next/standalone`
wholesale, so local rows would ship inside the image and be served as public
benchmark statistics on first boot. Both were live defects, found by assembling
the runtime filesystem by hand and booting it.

**56b. `outputFileTracingIncludes` pins pdfkit's standard fonts.**
`@react-pdf/renderer` depends on pdfkit, which loads the AFM metrics for the 14
standard PDF fonts through a `require()` whose path is assembled at run time.
Next's static tracer cannot follow it, so the entire `standard-fonts` directory
was omitted from the standalone bundle. Dev and `next start` both worked,
because the full `node_modules` tree is on disk — the failure existed only
inside the container, as a 500 on the PDF export. The board pack is the export
most likely to matter to the person paying for this, so it failing only in
production is the worst possible shape for a bug.

**56c. `npm run verify:standalone` inspects the artefact, not the dev server.**
The two defects above share a root cause: every test ran against a tree that
had more files on disk than the image would. `scripts/verify-standalone.mjs`
asserts against `.next/standalone` itself — entrypoint, rate card, pdfkit
fonts, each server-external package, and the `.dockerignore` entries — and runs
in CI straight after the build. It is deliberately a filesystem check rather
than another HTTP test, because the failure mode is a missing file.

---

## 8. Things deliberately not done

**57. No accounts, no sign-in, no server-side session.**
The moment you have accounts you have PII, and constraint C1 is absolute.

**58. No analytics beyond aggregate counters.**
No page-view tracking, no session recording, no third-party scripts.

**59. No currency conversion.**
The rate card is USD. Converting would require a live FX source, which means a
network dependency and a rate that is stale the moment it is exported. The
currency is stated on the card and on every artifact.

**60. No attempt to predict Microsoft's future pricing.**
The tool models what is published today and stamps the date. Extrapolation would
look authoritative and be guesswork.

---

## 9. Post-verification corrections

These four entries record changes made after the initial build, in response to
independent verification of the rate card and the export writer.

**61. GitHub Copilot migrated from premium requests to AI credits.**
GitHub moved off premium requests to AI credits on 1 June 2026. The card now
carries `consumption["github-ai-credit"]` and a rebuilt
`commercial.githubCopilot`. Five judgement calls sit inside that change:

- *The card version moved from `v1` to `v1.1`.* Not asked for, but benchmark
  records stamp `rateCardVersion`, and leaving it at `v1` would let submissions
  priced under the old GitHub numbers mix indistinguishably with corrected ones
  in the public aggregate. The filename stays `rate-card.v1.json`; the version
  string is what the app and the exports read.
- *The nested `plans` shape was adopted* from the corrected sibling card rather
  than invented, so `githubCopilot[plan]` became `githubCopilot.plans[plan]`.
  That changes the `rateCardRef` strings in the audit trail, which is a visible
  break, but a shared shape across the two tools is worth more than stable refs.
- *`github-ai-credit` is carried at 1 credit.* A GitHub AI credit is $0.01 and
  so is `paygCreditUsd`, so a 1:1 rate keeps a single credit column through the
  engine. The JSON note states plainly that they are different currencies and
  that GitHub overage cannot draw on a Microsoft capacity pack, MACC or Azure
  prepayment. See decision 64 for what this still leaves unmodelled.
- *The per-user assumptions were re-derived, not converted.* 3,500 credits for a
  heavy user and 700 for a standard one, built up from the archetypes at their
  typical values. Chosen deliberately so a standard user sits inside the 1,900
  Business allowance and a heavy user outside it but inside Enterprise's 3,900 —
  that boundary is the planning signal a buyer actually needs. They are
  placeholders, flagged `verified: false`, and a test pins the relationship.
- *`modelTierMultiplier` was left unchanged*, because GitHub still bills by
  model and token volume, so the tier spread survives the units change.

Code completions and next edit suggestions are unlimited and never billed. That
is the single most common misunderstanding about this SKU and it decides whether
a customer needs overage at all, so it is stated on the methodology page as a
highlighted callout rather than a bullet.

**62. Copilot Cowork is not zero-rated by a Microsoft 365 Copilot licence.**
`cowork-task.offsetByM365CopilotLicence` was `true`; it is now `false` with an
`offsetNote` explaining the distinction. Cowork task execution consumes Copilot
Credits against the organisation's Microsoft 365 usage-based billing limit; it
is not offset by holding a seat, unlike core Copilot Studio agent activity. The
wizard copy already said "with no seat licence to offset it", which confirmed
the JSON flag was the defect rather than the concept.

Cowork keeps a licensed-share field, but a bespoke one — `LICENSED_PCT_NO_OFFSET`
— because the shared `LICENSED_PCT` copy promises an offset that no longer
applies here. The field is still collected because it genuinely feeds the
estate-wide licence break-even through `normalise.ts`.

**63. The XLSX writer guards aggregate ranges over empty row sets.**
`SUM(C{start}:C{end})` was emitted with `end = worksheet.rowCount`, so a section
with zero rows produced an inverted range like `SUM(C5:C4)`. All aggregate sites
now route through an `agg()` helper that writes a literal `0` when `end < start`.

Two things about this were worse than reported. The defect was reachable from
`defaultAnswers()`, which ships `workloads: []` — so the malformed range was on
the ordinary export path, not only behind an empty-selection API call. And
`zebra()`, suspected of the same fault, is in fact already safe: its
`for (i = from; i <= to)` simply no-ops on an inverted range. It was left alone
rather than "fixed", because changing correct code to look defensive hides which
line was actually wrong.

The regression test unzips the real `.xlsx` bytes — central-directory walk plus
`inflateRawSync`, no new dependency — and scans the sheet XML for inverted
ranges. Asserting against the writer's own view of the workbook would have
passed against the bug, since the bug is in what gets serialised. The test was
verified non-vacuous by removing the guard and watching it fail.

**64. The e2e suite is pinned to an isolated port.**
`playwright.config.ts` had `reuseExistingServer: !CI` against a hard-coded port
3000. `reuseExistingServer` adopts *any* listener on that port, so a dev server
belonging to an unrelated repository was silently accepted and 18 of 28 specs
asserted against the wrong application. The port is now `E2E_PORT`, and a
running server is only adopted when `E2E_REUSE_SERVER=1` says so explicitly. A
suite that quietly tests someone else's app is worse than no suite, because it
reports failures that are real and unrelated.

## 10. Separating the two credit currencies

Section 9 left a caveat: a GitHub AI credit and a Microsoft Copilot Credit both
cost $0.01, so carrying GitHub overage at a 1:1 rate kept one clean credit
column through the engine. That was convenient and wrong. Independent
verification flagged the consequence, and it is worth stating plainly, because
it produced a materially incorrect recommendation rather than a cosmetic one.

**65. GitHub AI credits and Microsoft Copilot Credits are now separate
currencies, and no Microsoft funding vehicle may claim to fund GitHub.**

The defect: GitHub overage landed in the same `billableCredits` pool as
Microsoft consumption. Every downstream consumer then treated it as Microsoft
demand. A capacity pack was sized to cover it, a P3 pre-purchase tier was sized
to discount it, and a MACC burn-down claimed credit for it. None of those
vehicles can pay a bill GitHub raises. The tool was recommending an organisation
spend money on an instrument that could not touch the cost it was bought for.

Sub-decisions:

- *The currency is declared in the rate card, not in TypeScript.* Every one of
  the 18 `consumption` rows now carries a `currency`, and a new top-level
  `creditCurrencies` block holds the unit price, the meter that raises the bill,
  and `fundableBy` — the list of funding option ids that may fund it. The engine
  derives eligibility from that list rather than hard-coding it, which keeps
  funding policy as data, consistent with constraint C6. `github-ai-credit` has
  `fundableBy: []`.
- *`CreditModel`'s scalar totals are now Microsoft-only.* `billableCredits`,
  `grossCredits`, `offsetCredits` and the `byWorkload` rollup count the
  Microsoft meter alone. Every downstream consumer — scenario band, licence
  break-even, all eight funding options, pack sizing — therefore became correct
  with no change at the call sites. `lines` still carries every line so the UI
  and the exports can show them; the split is exposed through `byCurrency`.
- *GitHub overage is modelled as a platform cost line.* A platform line is
  already defined as a cost common to every funding option that no vehicle can
  alter, which is exactly the property GitHub overage has. Routing it there was
  both the smallest change and the structurally correct one, and it means the
  GitHub bill is charged identically under all eight options, so it can never
  tip the recommendation.
- *The rate card version moved to `v1.2`,* for the same reason as `v1.1`:
  benchmark records stamp `rateCardVersion`, and estimates priced before and
  after this correction are not comparable.
- *`creditCurrencies[*].unitUsd` duplicates a price that also lives under
  `commercial`.* That is deliberate — the engine wants one lookup — but
  duplication drifts, so a rate-card test pins the two against each other. The
  first version of this change had exactly that bug: `unitUsd` was set to the
  whole `paygCreditUsd` rate object rather than its `.value`, which produced
  `NaN` throughout. The property-based invariant harness caught it on the first
  run, which is the argument for the harness.

**66. Two defects that the currency split exposed rather than caused.**

- *Capacity packs were floored at one pack even against zero demand.*
  `Math.max(1, ceil(target / packSize))` is right for a customer with genuine
  but negligible demand, and wrong for a customer with none. Before the split no
  estate could have zero Microsoft demand while still having a bill, so the case
  was unreachable; a GitHub-only estate reaches it. It now buys nothing when
  annual demand is zero, and the test that asserted the old behaviour has been
  re-pointed at a genuinely negligible — but non-zero — estate, preserving its
  original intent.
- *"Do nothing" reported $0 against a real bill, and won.* Declining to fund is
  a real choice about Microsoft credits and Microsoft seats. It is not a choice
  about GitHub AI credit overage, which is enabled by default and bills against
  seats already held. Zeroing it made an unavoidable cost look like a saving and
  handed "do nothing" an unearned first place on a GitHub-only estate. It now
  carries the unfundable other-meter lines, and it is disqualified when there is
  demand on any meter, not only the Microsoft one.

**67. The XLSX CreditModel total priced GitHub credits at Microsoft rates.**
The sheet summed every credit line into one total and then multiplied it by the
Microsoft pay-as-you-go and capacity-pack rates to derive cost and break-even.
With a GitHub line in that total the derived figures were simply wrong — in a
spreadsheet a customer takes to their finance team. The sheet is now split into
per-meter blocks: only the Microsoft block feeds the total that gets priced, and
other meters get their own labelled subtotal below it. The regression test reads
the workbook back and asserts the summed range spans exactly the Microsoft lines;
reverting the fix makes it fail, so it is not vacuous.

**68. A property-based invariant harness now guards the engine.**
`tests/unit/engine/invariants.test.ts` generates schema-valid random `Answers`
from a seeded PRNG and asserts roughly thirty accounting identities against each
result, plus a deep scan for non-finite numbers and a check that every audit
`rateCardRef` resolves to a real path in the card. It found three defects on its
first run, two of them real:

- `recommendation.*.score` was `Infinity` for disqualified options. `Infinity`
  does not survive `JSON.stringify` — it becomes `null`. It did not cross a JSON
  boundary today, so this was a latent hazard rather than a live bug, but the
  sentinel is gone: the score stays finite and real, and a new `blocked` flag
  sorts disqualified options last.
- An audit entry referenced `commercial.m365CopilotSeat`, which does not exist
  in the card. That one was live and user-visible: `rateCardRef` is rendered in
  the results audit trail and in the XLSX AuditTrail sheet. Corrected to
  `commercial.m365CopilotSeatMonthlyUsd`.

The third was a false alarm worth recording. An assertion that a targeted
licence shift never removes more credits than are offsettable fired on about 30
of 2,000 seeds. Instrumenting it to print magnitudes showed a relative
difference of 1.2e-16 — one double ULP. The tolerance was wrong, not the engine.
The lesson is to measure the size of a discrepancy before calling it a defect.

## 11. Pressure test: usability, errors and accuracy

The brief was to pressure test the built app with the bar set at "the output MUST
be accurate". Three defects were found and fixed; several suspected defects were
investigated and proved to be correct behaviour, which is recorded here so the
same ground is not re-covered.

69. **The workload picker told the user GitHub Copilot bills Copilot Credits.**
    The chip on every credit-metered card in step 2 was the hard-coded string
    "Copilot Credits". After the currency split that was simply untrue for
    GitHub Copilot, which bills AI credits on GitHub's own meter — the exact
    conflation the split exists to prevent, still being asserted on the page
    where the user chooses what to model. The card's own blurb contradicted its
    chip. Fixed by adding `WorkloadMeta.creditMeter` and deriving the chip label
    from the rate card, so it reads "GitHub AI credits" or "Microsoft Copilot
    Credits". The declaration is pinned to what the engine actually emits by a
    table-driven test over every metered workload, so a workload that changes
    meter cannot leave a stale label behind.

70. **Every export and the results table presented ruled-out options as
    candidates.** All four renderers showed `FundingOption.eligible`, which is
    structural buyability, rather than `RankedOption.blocked`, which is the
    recommendation's actual verdict. "Do nothing" is the dangerous case: it is
    always structurally eligible, and because it declines to fund the demand
    rather than costing it, it frequently carries the *lowest* twelve-month
    figure in the table. On the mixed-estate fixture the board slide read "Do
    nothing — $748,800 — eligible: yes" in full ink, directly beneath a
    recommendation of $1,072,794. A reader scanning that table for the cheapest
    eligible row would reach the opposite of the engine's conclusion, wrong by
    $324,000. All four renderers now key off `blocked`, the column is headed
    "Candidate" rather than "Eligible", and a blocked row shows the rule's own
    explanation instead of an eligibility message.

71. **Exports were never checked for numeric agreement with the engine.** The
    existing export tests asserted that a PDF starts with `%PDF-` and that XLSX
    and PPTX are valid ZIP containers — structural validity only. Nothing
    asserted that the numbers inside matched the engine, which is the only
    property a customer's finance team cares about, and which is exactly where a
    real bug had already shipped. Added agreement tests that read all three
    formats back — ExcelJS for the workbook, slide XML for PPTX, and inflated
    content streams with hex-decoded text for the PDF — and pin the headline
    figures and rate card version to the engine result. Both new suites were
    proved non-vacuous by perturbing the expected values by 1% and confirming
    they fail.

Investigated and found correct, recorded so it is not re-litigated:

- **A disabled Continue button on the workloads step.** Suspected a silent dead
  end. It is not: the step shows "Nothing selected yet.", an inline "Select at
  least one workload to continue." beside the button, and a running-estimate
  hint. Correct behaviour, well explained.
- **GitHub AI credits showing as zero on the default estate.** Hand-calculated
  from the card: 200 seats, 30% heavy, standard tier gives 308,000 credits
  against a pooled allowance of 380,000. Genuinely zero overage, not a zeroing
  bug. The same hand calculation confirmed the 400-seat premium-tier case at
  6,240,000 credits and $62,400 a month, matching the engine exactly.
- **A 429 in the browser console.** Left over from deliberate rate-limit
  probing. The submitter already handles a rejected contribution with a polite
  `aria-live` message and affects nothing else on the page.
- **Layout overlap in a full-page screenshot.** An artefact of capturing sticky
  elements during a full-page scroll, not a rendering defect. Confirmed clean in
  a viewport-sized capture and by a zero horizontal overflow check at 380px.
