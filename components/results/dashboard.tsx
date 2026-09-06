'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useHydratedSession } from '@/lib/store/guards';
import { useSession, skippedCount } from '@/lib/store/session';
import { runEngine } from '@/lib/engine';
import type { AuditEntry, EngineResult, FundingOption, RankedOption, RiskSeverity } from '@/lib/engine/types';
import { workloadMeta } from '@/lib/schemas/taxonomy';
import { Badge, Button, Card, CardTitle } from '@/components/ui/primitives';
import { ChartFrame, DataTable } from './chart-frame';
import { BulletRow, Treemap, Tornado, Waterfall } from './charts';
import { BenchmarkPlacement } from './benchmark-placement';
import { BenchmarkSubmitter } from './benchmark-submitter';
import { ExportBar } from './export-bar';
import { cn, compact, compactUsd, num, pct, usd } from '@/lib/ui';

const Projection = dynamic(() => import('./projection'), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-field bg-bg-sunken" />,
});

export function Dashboard() {
  const hydrated = useHydratedSession();
  const answers = useSession((s) => s.answers);
  const touched = useSession((s) => s.touched);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const skipped = useMemo(() => skippedCount({ answers, touched }), [answers, touched]);

  useEffect(() => {
    if (!hydrated) return;
    if (answers.workloads.length === 0) {
      setResult(null);
      return;
    }
    try {
      setResult(runEngine(answers));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The estimate could not be calculated.');
    }
  }, [hydrated, answers]);

  if (!hydrated) {
    return <div className="h-96 animate-pulse rounded-card bg-bg-sunken" />;
  }

  if (answers.workloads.length === 0 || error) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-lg font-semibold">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {error ??
            'Your session has no workloads selected — either you have not run the assessment in this tab, or the page was reloaded and the in-memory session was cleared.'}
        </p>
        <Link href="/assess/0" className="mt-5 inline-block">
          <Button>Start the assessment</Button>
        </Link>
      </Card>
    );
  }

  if (!result) return <div className="h-96 animate-pulse rounded-card bg-bg-sunken" />;

  return <Results result={result} skipped={skipped} />;
}

/* ------------------------------------------------------------------ */

function Results({ result, skipped }: { result: EngineResult; skipped: number }) {
  const { credits, cost, scenario, recommendation, licenceBreakEven, fundingOptions } = result;
  const primary = fundingOptions.find((o) => o.id === recommendation.primary.optionId);
  const payg = fundingOptions.find((o) => o.id === 'payg');
  const eligible = fundingOptions.filter((o) => o.eligible);
  const maxOption = Math.max(...fundingOptions.map((o) => o.twelveMonthTotalUsd), 1);

  return (
    <div className="space-y-5" data-rate-card={result.rateCardVersion}>
      {/* ------------------------------------------------- Headline */}
      <section className="card relative overflow-hidden p-6 sm:p-8">
        <div className="mesh pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Recommended</Badge>
            <Badge
              tone={
                recommendation.confidenceChip === 'High'
                  ? 'success'
                  : recommendation.confidenceChip === 'Medium'
                    ? 'info'
                    : 'warn'
              }
            >
              {recommendation.confidenceChip} confidence
            </Badge>
            {skipped > 0 ? <Badge tone="neutral">{skipped} defaults used</Badge> : null}
            <Badge tone="neutral">Rate card {result.rateCardVersion}</Badge>
          </div>

          <h1 className="mt-4 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {recommendation.primary.label}
          </h1>
          <p className="mt-2 max-w-3xl text-pretty text-sm leading-relaxed text-fg-muted">
            {recommendation.headline}
          </p>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="12-month total"
              value={usd(recommendation.primary.twelveMonthTotalUsd)}
              sub={primary ? `${usd(primary.effectiveUsdPerCredit, true)} effective per credit` : undefined}
            />
            <Stat
              label="Billable Copilot Credits / month"
              value={num(credits.billableCredits)}
              sub={`${num(credits.grossCredits)} gross, ${num(credits.offsetCredits)} offset — Microsoft meter only`}
            />
            <Stat
              label="Expected monthly cost"
              value={usd(cost.totalMonthlyUsd)}
              sub={`${usd(cost.meteredCreditCostUsd)} credits + ${usd(cost.platformMonthlyUsd)} platform`}
            />
            <Stat
              label="Saving vs naive pay-as-you-go"
              value={usd(recommendation.annualSavingVsNaivePaygUsd)}
              sub={payg ? `Pay-as-you-go would be ${usd(payg.twelveMonthTotalUsd)}` : undefined}
              tone={recommendation.annualSavingVsNaivePaygUsd > 0 ? 'success' : 'neutral'}
            />
          </dl>

          {recommendation.safetyNet ? (
            <p className="mt-5 rounded-field border border-info/40 bg-info-quiet px-3 py-2 text-xs text-fg-muted">
              <strong className="font-medium text-fg">Safety net.</strong> {recommendation.safetyNet}
            </p>
          ) : null}
        </div>
      </section>

      <ExportBar result={result} />

      {credits.byCurrency.length > 1 ? (
        <Card>
          <h2 className="text-lg font-medium text-fg">Two credit meters, billed separately</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            Your estate consumes credits on more than one meter. They are priced the same but they
            are not the same currency, and no Microsoft purchasing vehicle — capacity pack,
            pre-purchase tier, MACC burn-down or Azure prepayment — can pay a bill raised on another
            meter. Everything below the Microsoft line is charged identically under every funding
            option on this page, so it never changes which option wins.
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">
                Monthly billable credits and cost, split by billing meter
              </caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-fg-subtle">
                  <th scope="col" className="py-2 pr-4 font-medium">Credit currency</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Billed by</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Credits / month</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Cost / month</th>
                  <th scope="col" className="py-2 font-medium">Fundable by a Microsoft vehicle?</th>
                </tr>
              </thead>
              <tbody>
                {credits.byCurrency.map((c) => (
                  <tr key={c.currency} className="border-b border-line/50 last:border-0">
                    <th scope="row" className="py-2 pr-4 font-normal text-fg">{c.label}</th>
                    <td className="py-2 pr-4 text-fg-muted">{c.meter}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-fg">
                      {num(c.billableCredits)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-fg">
                      {usd(c.billableCostUsd)}
                    </td>
                    <td className="py-2 text-fg-muted">
                      {c.fundableBy.length > 0 ? 'Yes' : 'No — pay-as-you-go on its own meter'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {credits.byCurrency.some((c) => c.currency === 'github-ai-credit') ? (
            <p className="mt-4 rounded-field border border-info/40 bg-info-quiet px-3 py-2 text-xs text-fg-muted">
              <strong className="font-medium text-fg">Code completions are free.</strong> On paid
              GitHub Copilot plans, code completions and next edit suggestions are unlimited and
              never consume AI credits. Only Copilot Chat, Copilot CLI, the cloud agent, Spaces,
              Spark and third-party coding agents draw on the allowance — so the figure above counts
              those alone.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* ------------------------------------------------- Why this */}
      <Card>
        <CardTitle hint="Each rule below either fired or did not, and every one is shown so you can see what was considered rather than only what won.">
          Why this recommendation
        </CardTitle>
        <ul className="space-y-2">
          {recommendation.rules.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-[auto_1fr] items-start gap-3 rounded-field border border-line/70 p-3"
            >
              <span
                aria-hidden="true"
                className={
                  r.fired
                    ? 'mt-1 size-2 shrink-0 rounded-full bg-accent'
                    : 'mt-1 size-2 shrink-0 rounded-full bg-fg-subtle/35'
                }
              />
              <div>
                <p className="text-sm font-medium">
                  {r.name}{' '}
                  <span className="text-2xs font-normal text-fg-subtle">
                    {r.fired ? 'fired' : 'did not fire'}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">{r.reason}</p>
                {r.fired ? <p className="mt-1 text-xs text-accent">{r.effect}</p> : null}
              </div>
            </li>
          ))}
        </ul>
        {recommendation.governanceActions.length > 0 ? (
          <div className="mt-4 rounded-field bg-bg-sunken p-3">
            <p className="text-xs font-medium">Do these regardless of which option you pick</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-fg-muted">
              {recommendation.governanceActions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* ------------------------------------------------- Waterfall + mix */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartFrame
          title="From raw activity to what you actually pay for"
          hint="Licence offset is the single largest lever most organisations have."
          table={{
            caption: 'Credit waterfall, monthly',
            columns: ['Stage', 'Credits'],
            rows: [
              ['Gross credits generated', Math.round(credits.grossCredits)],
              ['Offset by M365 Copilot licences', -Math.round(credits.offsetCredits)],
              ['Billable Copilot Credits (Microsoft meter)', Math.round(credits.billableCredits)],
              ['— of which internal', Math.round(credits.internalBillableCredits)],
              ['— of which external / customer-facing', Math.round(credits.externalBillableCredits)],
              [
                'Still offsettable if every internal user were licensed',
                Math.round(credits.offsettableRemainingCredits),
              ],
              ...(credits.otherMeterBillableCredits > 0
                ? ([
                    [
                      'Billed on another meter (not Microsoft Copilot Credits)',
                      Math.round(credits.otherMeterBillableCredits),
                    ],
                  ] as Array<[string, number]>)
                : []),
            ],
          }}
        >
          <Waterfall
            unit="credits"
            steps={[
              { label: 'Gross credits', value: credits.grossCredits, kind: 'start' },
              { label: 'Licence offset', value: credits.offsetCredits, kind: 'down' },
              { label: 'Billable', value: credits.billableCredits, kind: 'total' },
            ]}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <MiniStat label="Internal billable" value={num(credits.internalBillableCredits)} />
            <MiniStat label="External billable" value={num(credits.externalBillableCredits)} />
          </div>
        </ChartFrame>

        <ChartFrame
          title="Where the credits come from"
          hint="Sized by billable credits per month. Concentration matters — one workload above 60% is a single point of budget failure."
          table={{
            caption: 'Billable credits by workload, monthly',
            columns: ['Workload', 'Gross credits', 'Billable credits', 'Share of billable'],
            rows: credits.byWorkload.map((w) => [
              workloadMeta(w.workloadId).label,
              Math.round(w.grossCredits),
              Math.round(w.billableCredits),
              pct((w.billableCredits / (credits.billableCredits || 1)) * 100),
            ]),
          }}
        >
          <Treemap
            unit="credits"
            nodes={credits.byWorkload.map((w) => ({
              label: workloadMeta(w.workloadId).label,
              value: w.billableCredits,
            }))}
          />
        </ChartFrame>
      </div>

      {/* ------------------------------------------------- Projection */}
      <ChartFrame
        title="Twelve-month projection"
        hint={`Adoption ramp and seasonality applied. Coefficient of variation ${scenario.coefficientOfVariation.toFixed(2)} — ${scenario.coefficientOfVariation > 0.35 ? 'volatile enough that a fixed commitment carries real waste risk' : 'stable enough to commit against'}.`}
        right={
          <Badge tone={scenario.coefficientOfVariation > 0.35 ? 'warn' : 'success'}>
            CV {scenario.coefficientOfVariation.toFixed(2)}
          </Badge>
        }
        table={{
          caption: 'Monthly credit projection by scenario band',
          columns: ['Month', 'Conservative', 'Expected', 'Aggressive', 'Ramp', 'Seasonality'],
          rows: scenario.months.map((m) => [
            m.label,
            Math.round(m.conservativeCredits),
            Math.round(m.expectedCredits),
            Math.round(m.aggressiveCredits),
            m.rampFactor.toFixed(2),
            m.seasonalityFactor.toFixed(2),
          ]),
        }}
      >
        <Projection months={scenario.months} />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['conservative', 'expected', 'aggressive'] as const).map((b) => (
            <MiniStat
              key={b}
              label={`${b.charAt(0).toUpperCase()}${b.slice(1)} · ${scenario.bands[b].multiplier}×`}
              value={`${compact(scenario.bands[b].monthlyCredits)} cr`}
              sub={compactUsd(scenario.bands[b].annualCreditCostUsd)}
            />
          ))}
          <MiniStat
            label={`Peak month (${scenario.months[scenario.peakMonthIndex]?.label ?? '—'})`}
            value={`${compact(scenario.peakMonthCredits)} cr`}
            sub="Size any commitment against this, not the mean"
          />
        </div>
      </ChartFrame>

      {/* ------------------------------------------------- Options */}
      <ChartFrame
        title="All eight funding options, costed the same way"
        hint="Ranked by 12-month total across options still in contention. Options that are ruled out are still shown with the reason, because 'why not' is usually the question that gets asked."
        table={{
          caption: 'Funding option comparison over twelve months',
          columns: [
            'Option',
            '12-month total',
            'Δ vs recommended',
            'Effective $/credit',
            'Peak month',
            'Waste',
            'Shortfall risk',
            'Lock-in (months)',
          ],
          rows: fundingOptions.map((o) => [
            `${o.label}${recommendation.ranked.find((r) => r.optionId === o.id)?.blocked ? ' (ruled out)' : ''}`,
            usd(o.twelveMonthTotalUsd),
            usd(o.twelveMonthTotalUsd - recommendation.primary.twelveMonthTotalUsd),
            usd(o.effectiveUsdPerCredit, true),
            usd(o.peakMonthUsd),
            `${usd(o.wasteUsd)} (${pct(o.wastePctOfPurchased)})`,
            pct(o.shortfallRiskPct),
            o.commitmentLockInMonths,
          ]),
        }}
      >
        <div className="space-y-2">
          {eligible
            .slice()
            .sort((a, b) => a.twelveMonthTotalUsd - b.twelveMonthTotalUsd)
            .map((o) => (
              <BulletRow
                key={o.id}
                label={o.label}
                value={o.twelveMonthTotalUsd}
                max={maxOption}
                highlight={o.id === recommendation.primary.optionId}
              />
            ))}
        </div>
        <div className="mt-4 overflow-x-auto">
          <OptionDetail
            options={fundingOptions}
            primaryId={recommendation.primary.optionId}
            ranked={recommendation.ranked}
          />
        </div>
      </ChartFrame>

      {/* ------------------------------------------------- Break-even */}
      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card>
          <CardTitle hint="The flagship calculation: at what monthly consumption does a $30 Copilot seat pay for itself?">
            Licence offset break-even
          </CardTitle>
          <p className="text-sm leading-relaxed text-fg-muted">{licenceBreakEven.narrative}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Stat
              label="Break-even at pay-as-you-go"
              value={`${num(licenceBreakEven.breakEvenCreditsAtPayg)} cr/mo`}
              sub={`${usd(licenceBreakEven.seatMonthlyUsd)} seat ÷ pay-as-you-go rate`}
            />
            <Stat
              label="Break-even at pack rate"
              value={`${num(licenceBreakEven.breakEvenCreditsAtPackRate)} cr/mo`}
              sub="Cheaper credits raise the bar a licence must clear"
            />
            <Stat
              label="Unlicensed internal users above the line"
              value={`${num(licenceBreakEven.usersAboveBreakEven)} of ${num(licenceBreakEven.unlicensedInternalUsers)}`}
              sub={pct(licenceBreakEven.shareOfUsersAboveBreakEvenPct)}
            />
            <Stat
              label="Net benefit of a targeted licence shift"
              value={usd(licenceBreakEven.annualNetBenefitUsd)}
              tone={licenceBreakEven.worthwhile ? 'success' : 'warn'}
              sub={
                licenceBreakEven.worthwhile
                  ? `${usd(licenceBreakEven.annualMeteredSpendRemovedUsd)} metered spend removed − ${usd(licenceBreakEven.annualSeatCostUsd)} seats`
                  : 'Seats would cost more than the metered spend they remove'
              }
            />
          </dl>
          <p className="mt-4 rounded-field bg-bg-sunken p-3 text-xs text-fg-muted">
            {num(licenceBreakEven.externalCreditsNeverOffsettable)} credits a month (
            {usd(licenceBreakEven.externalMonthlyCostUsd)}) are customer-facing and can never be
            offset by a licence, however many seats you buy.
          </p>
        </Card>

        <ChartFrame
          title="What moves the number"
          hint="Each input varied independently, everything else held at your answer."
          table={{
            caption: 'One-way sensitivity on 12-month total cost',
            columns: ['Input', 'Low', 'High', 'Low total', 'High total', 'Swing', 'Swing %'],
            rows: result.sensitivity.map((s) => [
              s.label,
              s.lowValue,
              s.highValue,
              usd(s.lowTotalUsd),
              usd(s.highTotalUsd),
              usd(s.swingUsd),
              pct(s.swingPct),
            ]),
          }}
        >
          <Tornado
            items={result.sensitivity.slice(0, 8).map((s) => ({
              label: s.label,
              low: s.lowTotalUsd,
              high: s.highTotalUsd,
              baseline: s.baselineTotalUsd,
            }))}
          />
        </ChartFrame>
      </div>

      {/* ------------------------------------------------- Risks */}
      <Card>
        <CardTitle hint="Generated from your own answers, not a generic list.">
          Risk register
        </CardTitle>
        <ul className="space-y-2">
          {result.risks.map((r) => (
            <li key={r.id} className="rounded-field border border-line/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                <span className="text-sm font-medium">{r.title}</span>
              </div>
              <p className="mt-1.5 text-xs text-fg-muted">{r.description}</p>
              <p className="mt-1 text-xs">
                <span className="text-fg-subtle">Mitigation — </span>
                {r.mitigation}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <BenchmarkPlacement result={result} />
      <BenchmarkSubmitter result={result} />

      {/* ------------------------------------------------- Audit */}
      <AuditTrail result={result} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OptionDetail({
  options,
  primaryId,
  ranked,
}: {
  options: FundingOption[];
  primaryId: string;
  /**
   * The recommendation's verdict per option. Structural eligibility is not the whole
   * story: an option can be perfectly buyable and still be ruled out by a rule. "Do
   * nothing" is the dangerous case — it is always buyable and frequently carries the
   * lowest 12-month figure in this table, so presenting it as a live candidate invites
   * a reader to pick the cheapest row and be badly wrong.
   */
  ranked: RankedOption[];
}) {
  const verdictById = new Map(ranked.map((r) => [r.optionId, r]));
  return (
    <table className="w-full min-w-[52rem] border-collapse text-left text-xs">
      <caption className="sr-only">Funding option characteristics</caption>
      <thead>
        <tr className="border-b border-line-strong text-fg-muted">
          <th scope="col" className="py-2 pr-3 font-medium">
            Option
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            12-month
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            $/credit
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            Waste
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            Shortfall
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Cash flow
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            MACC
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Reversibility
          </th>
        </tr>
      </thead>
      <tbody>
        {options.map((o) => {
          const verdict = verdictById.get(o.id);
          const ruledOut = verdict?.blocked ?? !o.eligible;
          return (
          <tr
            key={o.id}
            className={
              o.id === primaryId
                ? 'border-b border-line/50 bg-accent-quiet'
                : !ruledOut
                  ? 'border-b border-line/50'
                  : // Ruled-out rows used to be dimmed with opacity, which
                    // pushed their text below AA. They are de-emphasised with a
                    // recessed surface and an explicit label instead — the
                    // reason a row is ruled out is exactly the sort of thing a
                    // reader needs to be able to read.
                    'border-b border-line/50 bg-bg-sunken'
            }
          >
            <th scope="row" className="py-2 pr-3 font-normal">
              <span className="font-medium">{o.label}</span>
              {ruledOut ? (
                <span className="ml-2 rounded-full border border-line px-1.5 py-0.5 text-2xs text-fg-muted">
                  {o.eligible ? 'Ruled out' : 'Not eligible'}
                </span>
              ) : null}
              <span className="block text-2xs text-fg-muted">
                {!ruledOut
                  ? o.bestWhen
                  : o.eligible
                    ? (verdict?.tradeOff ?? '')
                    : o.ineligibleReasons.join('; ')}
              </span>
            </th>
            <td className="py-2 pr-3 text-right mono-num">{usd(o.twelveMonthTotalUsd)}</td>
            <td className="py-2 pr-3 text-right mono-num">{usd(o.effectiveUsdPerCredit, true)}</td>
            <td className="py-2 pr-3 text-right mono-num">{pct(o.wastePctOfPurchased)}</td>
            <td className="py-2 pr-3 text-right mono-num">{pct(o.shortfallRiskPct)}</td>
            <td className="py-2 pr-3">{o.cashFlowShape}</td>
            <td className="py-2 pr-3">{o.maccEligibility}</td>
            <td className="py-2 pr-3">{o.reversibility}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AuditTrail({ result }: { result: EngineResult }) {
  const [open, setOpen] = useState(false);
  const audit = result.audit;
  const groups = useMemo(() => {
    const m = new Map<string, AuditEntry[]>();
    for (const e of audit) {
      const key = e.step.split(':')[0] ?? e.step;
      const list = m.get(key) ?? [];
      list.push(e);
      m.set(key, list);
    }
    return [...m.entries()];
  }, [audit]);

  return (
    <Card>
      <CardTitle
        hint={`${result.audit.length} steps. Every number above traces back to one of these, with the formula and the rate-card reference used.`}
        right={
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Collapse' : 'Expand'} audit trail
          </Button>
        }
      >
        Show your working
      </CardTitle>
      {open ? (
        <div className="space-y-4">
          {groups.map(([group, entries]) => (
            <details key={group} open className="rounded-field border border-line/70">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium capitalize">
                {group} <span className="text-fg-subtle">({entries.length})</span>
              </summary>
              <div className="space-y-2 border-t border-line/70 p-3">
                {entries.map((e, i) => (
                  <div key={`${e.step}-${i}`} className="rounded-md bg-bg-sunken p-2.5">
                    <p className="font-mono text-2xs text-accent">{e.step}</p>
                    <p className="mt-1 font-mono text-2xs leading-relaxed text-fg-muted">
                      {e.formula}
                    </p>
                    <p className="mt-1 text-2xs">
                      <span className="text-fg-subtle">= </span>
                      <span className="font-medium mono-num">
                        {e.output.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>{' '}
                      <span className="text-fg-subtle">{e.outputUnit}</span>
                      {e.rateCardRef ? (
                        <span className="ml-2 text-fg-subtle">rate card → {e.rateCardRef}</span>
                      ) : null}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <DataTable
            caption="Audit trail summary by stage"
            columns={['Stage', 'Steps']}
            rows={groups.map(([g, e]) => [g, e.length])}
          />
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'success' | 'warn' | 'neutral';
}) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-xl font-semibold tracking-tight mono-num',
          tone === 'success' && 'text-success',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </dd>
      {/*
        The supporting line is a second <dd>, not a <p>. A <div> inside a <dl>
        may only group <dt>/<dd> pairs; a stray <p> breaks the list semantics
        and detaches the explanation from the figure it explains.
      */}
      {sub ? <dd className="mt-0.5 text-2xs text-fg-muted">{sub}</dd> : null}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-field bg-bg-sunken px-3 py-2">
      <p className="text-2xs text-fg-subtle">{label}</p>
      <p className="text-sm font-semibold mono-num">{value}</p>
      {sub ? <p className="text-2xs text-fg-subtle">{sub}</p> : null}
    </div>
  );
}

function severityTone(s: RiskSeverity) {
  return s === 'high' ? 'risk' : s === 'medium' ? 'warn' : 'info';
}
