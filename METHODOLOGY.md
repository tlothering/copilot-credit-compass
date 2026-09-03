# Methodology

How Copilot Credit Compass turns a handful of answers into a credit forecast, a
cost, and a funding recommendation.

This document is the written companion to the live `/methodology` page. The page
renders the *actual loaded rate card* — every number on it comes from
`data/rate-card.v1.json` at request time, so it can never drift from what the
engine used. This file explains the reasoning; the page shows the numbers.

**Rate card `v1`, effective 2026‑01‑01, USD.**

---

## 1. What this is and is not

It is a **planning estimate**. It models published list pricing against a
described workload to produce a defensible starting figure and a shortlist of
funding routes.

It is **not** a quote, a commitment, or a substitute for a conversation with
Microsoft or a licensing partner. Consumptive pricing changes, negotiated
discounts are not public, and real usage always surprises. Every export carries
this caveat.

The honest claim is narrower than it sounds and more useful for it: *given these
assumptions, here is the number and here is exactly how it was derived.*

---

## 2. The pipeline

The engine is a pure function. The same inputs always produce the same outputs,
with no clock, no randomness, and no I/O.

```
normalise → volumeModel → creditModel → costModel
          → scenarioBand → fundingOptions → recommendation
```

Each stage consumes only the previous stage's output. Every stage appends to an
audit trail of `{ step, formula, inputs, output, outputUnit, rateCardRef }`
entries. A default two-workload scenario produces 39 such entries, and they are
rendered on the results page, written into the PDF and included in the XLSX.

`rateCardRef` is a dotted path into the rate card — `commercial.paygCreditUsd`,
not `0.01`. A path stays true when the rate changes.

---

## 3. Formulas

These are exactly the expressions the engine evaluates.

**1. Monthly volume per line**

```
quantity       = usersOrItems × frequencyPerUserPerMonth × seasonalityFactor
internalVolume = quantity × internalSharePct
```

**2. Gross credits**

```
grossCredits = Σ over lines of ( quantity × creditsPerUnit )
```

**3. Offset and billable credits**

```
offsetCredits   = Σ over offset-eligible lines of ( grossCredits × offsetShare )
billableCredits = grossCredits − offsetCredits
```

**4. Metered cost**

```
meteredCreditCostUsd = billableCredits × effectiveUsdPerCredit
```

`effectiveUsdPerCredit` depends on the funding option being priced —
pay-as-you-go, the capacity pack rate, or a pre-purchase tier rate. This is why
the same volume produces eight different costs.

**5. Scenario band**

```
low      = expected × (1 − coefficientOfVariation)
expected = billableCredits
high     = expected × (1 + coefficientOfVariation)
```

**6. Capacity pack sizing**

```
packsNeeded = CEILING( creditsForTheMonth / creditsPerPack )
wastage     = ( packsNeeded × creditsPerPack ) − creditsForTheMonth
```

---

## 4. Why business days

Interactive workloads — chat, drafting, agent-assisted tasks — are idle at
weekends. Modelling on 30 calendar days would overstate consumption by roughly
40%.

`businessDaysPerMonth` and `hoursPerMonth` are rate-card values, not constants,
because they are exactly the sort of assumption a reader should be able to
challenge and change.

---

## 5. The scenario band is derived, not fixed

A fixed ±20% band tells you nothing about your own situation. Instead the band
is driven by the **coefficient of variation** of the modelled workload mix.

One steady, well-understood workload produces a narrow band. Eight speculative
agent workloads with uncertain adoption produce a wide one — correctly, because
that forecast genuinely is less certain.

When the coefficient of variation exceeds `volatilityThreshold`, the engine
treats the scenario as volatile and this materially changes the funding
recommendation: volatile demand argues against hard commitments.

---

## 6. Capacity pack sizing and the shortfall trade-off

Capacity packs **do not roll over**. Unused credits are lost at the reset day.

This creates an unavoidable trade-off:

- Size to the **mean** and you will be short roughly half of all months.
- Size to the **peak** and you will waste credits in most months.

The engine sizes to `packSizingPercentile` from the rate card and reports both
sides explicitly: `wastePctOfPurchased` and `shortfallRiskPct` appear as columns
on every funding option. Neither number is hidden, because the right answer
depends on whether an overage is acceptable to you — which is one of the wizard
questions.

---

## 7. The Microsoft 365 Copilot licence-offset break-even

This is the calculation that changes decisions, so it is worth stating carefully.

Some Copilot consumption is **offset** by a Microsoft 365 Copilot licence: a
licensed user's activity does not draw metered credits. So for a heavy user,
paying a fixed monthly seat fee can be cheaper than paying per credit.

**Break-even credits per user per month**

```
breakEvenCredits = m365CopilotSeatMonthlyUsd / usdPerCredit
```

Computed against **two** thresholds, because the answer depends on how you buy
credits:

| Credit source  | Break-even (credits / user / month) |
| -------------- | ----------------------------------- |
| Pay-as-you-go  | 3,000                               |
| Capacity pack  | 3,750                               |

Cheaper credits *raise* the bar a licence has to clear. Quoting a single
break-even number would conceal that.

**Users above the line**

```
perUserCredits    = offsetEligibleCredits / internalUsers
usersAboveTheLine = COUNT of unlicensed internal users whose modelled
                    per-user consumption exceeds breakEvenCredits
```

**Net effect of licensing those users**

```
creditSavingUsd = creditsAvoided × usdPerCredit
licenceCostUsd  = usersToLicense × m365CopilotSeatMonthlyUsd
netMonthlyUsd   = creditSavingUsd − licenceCostUsd
```

The output is deliberately phrased as a share of your population — "9.1% of your
800 unlicensed users sit above the line" — rather than as an abstract credit
count, because a percentage is something you can act on.

The model assumes consumption is distributed across users rather than uniform.
Real distributions are heavily skewed; a small number of power users typically
dominate. This is the single largest source of uncertainty in the calculation
and is stated as a limitation on the page.

---

## 8. The eight funding options

All eight are always evaluated and always displayed, including ones you are not
eligible for, with the reason stated.

| Option | Shape |
| ------ | ----- |
| `payg` | Pay-as-you-go only |
| `packs-only` | Capacity packs, hard stop at the limit |
| `packs-plus-payg` | Packs with a pay-as-you-go safety net |
| `p3-plus-payg` | P3 pre-purchase plus overage |
| `p3-packs-payg` | P3, packs and pay-as-you-go combined |
| `licence-shift` | Move heavy users onto M365 Copilot licences |
| `byom-foundry` | Bring your own model via Azure AI Foundry |
| `do-nothing` | The baseline |

Each carries `twelveMonthTotalUsd`, `effectiveUsdPerCredit`,
`wastePctOfPurchased`, `shortfallRiskPct`, `cashFlowShape`, `maccEligibility`,
`reversibility`, `bestWhen`, `avoidWhen` and — where applicable —
`ineligibleReasons`.

A tool that silently drops options looks like it is steering you. Showing "P3
pre-purchase — not eligible: you told us you cannot make an annual commitment"
is both more honest and more useful.

---

## 9. How the recommendation is chosen

Explicit ordered rules, not a weighted score. A score would be easier to write
and impossible to explain; the "why this one" text on the results page is
generated from the same logic that picked the winner.

The rules consider, in order: eligibility, twelve-month total cost, the
volatility of the forecast, whether an overage is acceptable, whether an annual
commitment is possible, and MACC eligibility.

**Ties break toward reversibility.** When two options are within noise of each
other, the one you can back out of is the better first commitment.

---

## 10. Assumptions, stated

All of these are rate-card values, visible on `/methodology` and changeable
without a code change:

- `businessDaysPerMonth` — interactive workloads do not run at weekends.
- `hoursPerMonth` — for time-based workloads.
- `packSizingPercentile` — the wastage/shortfall balance point.
- `volatilityThreshold` — the coefficient of variation above which demand is
  treated as volatile.
- `kAnonymityMinimum` — 5, the benchmark cohort floor.
- `outlierMaxMonthlyCredits` — 500,000,000, above which a benchmark submission
  is rejected.

---

## 11. Limitations

Stated plainly, because a tool that hides its weaknesses cannot be trusted on
its strengths.

1. **Per-user consumption is modelled, not observed.** Real distributions are
   skewed; the break-even analysis is most sensitive to this.
2. **List pricing only.** Negotiated discounts are not public and are not
   modelled. Your real rate is likely better.
3. **No currency conversion.** The card is USD. Converting would need a live FX
   feed, and an exported rate would be stale immediately.
4. **Rates marked `verified: false`** are inferred from documentation that does
   not state a number outright. They render with a visible chip everywhere.
5. **Point-in-time.** The card has an effective date. Microsoft's consumptive
   pricing moves; check the date before quoting a figure.
6. **No prediction of future pricing.** Extrapolation would look authoritative
   and be guesswork.

---

## 12. Verifying this yourself

- `/methodology` renders the live rate card with a source link per row.
- The results page shows the full audit trail for *your* inputs.
- The exported XLSX contains **live formulas**, not pasted values — change an
  input on the Inputs sheet and the model recalculates.
- `data/rate-card.v1.json` is a single readable file.
- `npm test` runs table-driven engine tests with hand-calculated expected
  values, so the arithmetic is independently checkable.
