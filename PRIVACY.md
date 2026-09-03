# Privacy

Copilot Credit Compass is built so that there is nothing sensitive to leak. Not
"we protect your data" — there is no data about you to protect.

This document is the written companion to the live `/privacy` page.

---

## 1. The short version

- No accounts, no sign-in, no server-side session.
- Your inputs and results live in **your browser tab** and are never sent
  anywhere, unless you explicitly choose to contribute to the benchmark.
- No tracking cookies. No analytics scripts. No third-party tags.
- Nothing that identifies you, your employer, your tenant or your device is
  collected — ever, by any path.

Close the tab and your assessment is gone. That is a deliberate design
constraint, not an oversight. It is why the wizard warns you on the very first
screen, before you have invested any effort.

---

## 2. Where your assessment lives

In memory, in your tab, with a `sessionStorage` mirror so a reload does not
destroy your work.

`sessionStorage` rather than `localStorage` specifically because the promise is
*"this lives in this tab"*. `localStorage` would outlive the tab and quietly
break that promise.

The calculation engine runs client-side. Nothing about your scenario is
transmitted to produce your result.

**Exports** (PDF, XLSX, PPTX) are generated server-side, because the underlying
libraries cannot run in a browser. Your inputs are posted to
`/api/export/[kind]`, rendered, and returned. They are **not written to disk,
not logged, and not retained** — the request data lives only for the duration of
the response.

---

## 3. The benchmark is opt-in, and you see the payload first

If — and only if — you choose to contribute, this is the *entire* document that
is stored. Not a description of it. The literal record:

```json
{
  "rateCardVersion": "v1",
  "industry": "Financial Services",
  "region": "UK&I",
  "employeeBand": "5k-25k",
  "knowledgeWorkerBand": "1k-5k",
  "workloads": ["copilot-studio-agents", "sharepoint-agents"],
  "agentCount": 12,
  "monthlyCreditsExpected": 1045000,
  "monthlyCostExpectedUsd": 80000,
  "creditsPerKnowledgeWorkerPerMonth": 900,
  "m365CopilotLicensedSharePct": 60,
  "mixClassicPct": 40,
  "mixGenerativePct": 40,
  "mixActionPct": 20,
  "graphGroundingPct": 30,
  "recommendedStrategy": "packs-plus-payg",
  "estimatedAnnualSavingVsPaygUsd": 120000,
  "id": "24109973-de69-4d58-901f-130a0c706b66",
  "submittedAt": "2026-09-03T20:00:00.000Z",
  "cohort": "Financial Services|UK&I|5k-25k"
}
```

Note what is **not** there: no name, no email, no company, no tenant ID, no IP
address, no user agent, no device identifier, no free text of any kind.

Every field is either a **coarse band** (`5k-25k`, not `7,412 employees`) or a
number you already saw on your own results page. The `id` is a random UUID
generated at submission and is not linked to anything. `industry`, `region` and
the size bands come from fixed enumerated lists — you cannot type into them, so
you cannot accidentally put identifying information into one.

You can verify this claim directly: complete an assessment, open your browser's
network inspector, and read the request body.

---

## 4. k-anonymity: why small cohorts never appear

A benchmark that reports "one organisation in Nordics Legal, 5,000–25,000
employees" is not anonymous. If there is only one such organisation in the
dataset, publishing its median publishes its data.

So the benchmark enforces a **minimum cohort size of 5** (`kAnonymityMinimum` in
the rate card). A cohort with fewer than five contributing organisations is
never emitted.

Crucially, k-anonymity is enforced at **read time, in the aggregation** — not at
write time. Records are stored; sparse cohorts are simply not published. If a
fifth organisation joins the cohort later, it becomes publishable. Discarding
data at write would have thrown away information that only needed to wait.

**Sparse cohorts roll up rather than vanish.** There is a four-level ladder:
a cohort below the floor is merged into a coarser grouping. Cohorts that simply
disappeared would leak information by their absence, and would make the
benchmark useless for smaller segments.

**Outliers are rejected and counted.** A submission above
`outlierMaxMonthlyCredits` (500,000,000 credits/month) is rejected, because one
fat-fingered input can move a median. The count of rejections is published as
`rejectedOutliers` in the summary, so the filtering is accountable rather than
invisible.

---

## 5. Rate limiting without storing IP addresses

Rate limiting needs to recognise a repeat caller **within a short window**. It
does not need to recognise them tomorrow, and it certainly does not need to
store their address.

So the rate limiter hashes the client IP with a **salt that rotates daily and is
never persisted**. Within a day, repeated requests from the same address produce
the same hash, so the limiter works. Once the salt rotates, yesterday's hashes
become permanently unlinkable to any address — including by us.

No IP address is ever written to storage. The hash exists only in memory, only
for the current window.

---

## 6. Telemetry

Application Insights is provisioned with `DisableIpMasking: false`.

Counter-intuitively, `false` means **mask the IP**. Left at its default,
Application Insights would retain client IP addresses, which would breach the
zero-PII constraint through the back door. This is called out explicitly because
it is the kind of default that quietly undoes a privacy design.

What is collected: aggregate request counts, response times, and error rates —
operational health only. No page-view tracking, no session recording, no
user-level identifiers, no third-party analytics.

---

## 7. Cookies

None for tracking. None for analytics. None for advertising.

The only client-side storage is the `sessionStorage` mirror of your own
assessment, described above, and a theme preference if you change it.

---

## 8. Data subject rights

There is no personal data to exercise rights over.

- **Access** — you already have everything: it is in your browser.
- **Erasure** — close the tab.
- **Portability** — export to PDF, XLSX or PPTX.
- **Rectification** — change your inputs and recalculate.

For a benchmark submission specifically, there is no way to identify which
record is yours, because the record contains nothing that identifies you. That
is the point. If you would rather not contribute, do not press the button — the
tool is fully functional without it.

---

## 9. Infrastructure posture

- **Managed identity only.** Cosmos DB is provisioned with
  `disableLocalAuth: true`, so no access key can be issued *at all*. This is
  stronger than not putting a key in application settings, because there is no
  key to put anywhere.
- The Container App ships with an **empty `secrets` array**.
- The one remaining platform credential — the Log Analytics shared key the
  Container Apps environment needs for its log shipper — is resolved by ARM
  between two Azure resources at deployment time and never becomes an
  application setting. It is documented rather than hidden.
- Traffic is HTTPS-only; an optional Front Door and WAF can be enabled with a
  single parameter.

---

## 10. Verifying all of this

Do not take it on trust:

1. Open the network inspector, complete an assessment, and confirm no request is
   made until you press an export or submit button.
2. Read the benchmark request body and compare it to §3.
3. Read `data/rate-card.v1.json`, `lib/benchmark/*` and `lib/db/*` — the whole
   pipeline is a few hundred readable lines.
4. `grep` the repository for any field that could carry a name, an email or a
   tenant. There is not one.
5. Read `infra/main.bicep` and confirm the empty `secrets` array and
   `disableLocalAuth: true`.
