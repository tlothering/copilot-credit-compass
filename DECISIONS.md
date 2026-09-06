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
