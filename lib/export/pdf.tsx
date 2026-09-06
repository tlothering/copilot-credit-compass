import React from 'react';
import type { ExportInput } from './index';
import { workloadMeta } from '@/lib/schemas/taxonomy';
import { getRateCard } from '@/lib/engine/rate-card';
import { DISCLAIMER, NEGOTIATION_QUESTIONS, ROADMAP } from './copy';

const money = (v: number) =>
  Number.isFinite(v) ? `$${Math.round(v).toLocaleString('en-US')}` : '—';
const money2 = (v: number) =>
  Number.isFinite(v) ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 3 })}` : '—';
const int = (v: number) =>
  Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—';
const pc = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—');

const INK = '#12181F';
const MUTED = '#5C6A78';
const LINE = '#DCE3EA';
const ACCENT = '#1F5FD0';
const OK = '#146B45';
const WARN = '#9A5A05';

export async function buildPdf({ answers, result }: ExportInput): Promise<Blob> {
  const {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    pdf,
  } = await import('@react-pdf/renderer');

  const s = StyleSheet.create({
    page: {
      paddingTop: 46,
      paddingBottom: 56,
      paddingHorizontal: 44,
      fontSize: 9,
      color: INK,
      fontFamily: 'Helvetica',
      lineHeight: 1.45,
    },
    cover: { paddingTop: 150, paddingHorizontal: 54, color: INK, fontFamily: 'Helvetica' },
    h1: { fontSize: 24, fontFamily: 'Helvetica-Bold', lineHeight: 1.2 },
    h2: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 8 },
    h3: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
    p: { marginBottom: 6 },
    muted: { color: MUTED },
    small: { fontSize: 7.5, color: MUTED },
    kicker: {
      fontSize: 8,
      letterSpacing: 1.4,
      color: ACCENT,
      fontFamily: 'Helvetica-Bold',
      marginBottom: 8,
    },
    rule: { borderBottomWidth: 1, borderBottomColor: LINE, marginVertical: 10 },
    row: { flexDirection: 'row' },
    th: {
      fontSize: 7.5,
      fontFamily: 'Helvetica-Bold',
      color: '#FFFFFF',
      backgroundColor: ACCENT,
      paddingVertical: 4,
      paddingHorizontal: 5,
    },
    td: {
      fontSize: 7.5,
      paddingVertical: 3.5,
      paddingHorizontal: 5,
      borderBottomWidth: 0.5,
      borderBottomColor: LINE,
    },
    statBox: {
      flex: 1,
      borderWidth: 1,
      borderColor: LINE,
      borderRadius: 4,
      padding: 8,
      marginRight: 6,
    },
    statLabel: { fontSize: 7, color: MUTED, marginBottom: 2 },
    statValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
    bullet: { flexDirection: 'row', marginBottom: 3 },
    dot: { width: 10 },
    footer: {
      position: 'absolute',
      bottom: 22,
      left: 44,
      right: 44,
      borderTopWidth: 0.5,
      borderTopColor: LINE,
      paddingTop: 5,
    },
    bar: { height: 7, backgroundColor: '#EAF0F8', borderRadius: 2 },
    barFill: { height: 7, backgroundColor: ACCENT, borderRadius: 2 },
  });

  const card = getRateCard();
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const { credits, cost, scenario, recommendation, licenceBreakEven, fundingOptions } = result;
  const payg = fundingOptions.find((o) => o.id === 'payg');
  const primary = fundingOptions.find((o) => o.id === recommendation.primary.optionId);

  const Footer = () => (
    <View style={s.footer} fixed>
      <Text style={s.small}>{DISCLAIMER}</Text>
      <Text
        style={[s.small, { marginTop: 3 }]}
        render={({ pageNumber, totalPages }) =>
          `Copilot Credit Compass · rate card ${result.rateCardVersion} (effective ${result.rateCardEffectiveDate}) · generated ${generated} UTC · page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );

  const Table = ({
    cols,
    widths,
    rows,
    aligns,
  }: {
    cols: string[];
    widths: number[];
    rows: (string | number)[][];
    aligns?: ('left' | 'right')[];
  }) => (
    <View>
      <View style={s.row}>
        {cols.map((c, i) => (
          <Text
            key={c + i}
            style={[
              s.th,
              { width: `${widths[i]}%`, textAlign: aligns?.[i] === 'right' ? 'right' : 'left' },
            ]}
          >
            {c}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.row, ri % 2 === 1 ? { backgroundColor: '#F6F9FC' } : {}]} wrap={false}>
          {r.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                s.td,
                {
                  width: `${widths[ci]}%`,
                  textAlign: aligns?.[ci] === 'right' ? 'right' : 'left',
                },
              ]}
            >
              {String(cell)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );

  const Bullets = ({ items }: { items: string[] }) => (
    <View>
      {items.map((b, i) => (
        <View key={i} style={s.bullet}>
          <Text style={s.dot}>•</Text>
          <Text style={{ flex: 1 }}>{b}</Text>
        </View>
      ))}
    </View>
  );

  const doc = (
    <Document
      title="Microsoft Copilot Credit & Funding Assessment"
      author="Copilot Credit Compass"
      subject={`Rate card ${result.rateCardVersion}`}
    >
      {/* 1 — Cover */}
      <Page size="A4" style={s.cover}>
        <Text style={s.kicker}>COPILOT CREDIT COMPASS</Text>
        <Text style={s.h1}>
          Microsoft Copilot{'\n'}Credit &amp; Funding{'\n'}Assessment
        </Text>
        <View style={[s.rule, { marginTop: 26, marginBottom: 18 }]} />
        <Text style={s.p}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Industry </Text>
          {answers.profile.industry}
        </Text>
        <Text style={s.p}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Organisation size </Text>
          {answers.profile.employeeBand} employees ·{' '}
          {int(answers.profile.knowledgeWorkers)} knowledge workers
        </Text>
        <Text style={s.p}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Workloads assessed </Text>
          {answers.workloads.length}
        </Text>
        <Text style={s.p}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Rate card </Text>
          {result.rateCardVersion}, effective {result.rateCardEffectiveDate} ({result.currency})
        </Text>
        <Text style={s.p}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Generated </Text>
          {generated} UTC
        </Text>
        <View style={{ position: 'absolute', bottom: 54, left: 54, right: 54 }}>
          <Text style={s.small}>{DISCLAIMER}</Text>
        </View>
      </Page>

      {/* 2 — Executive summary */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>EXECUTIVE SUMMARY</Text>
        <Text style={s.h2}>The decision in one page</Text>
        <Text style={[s.p, { fontSize: 11, lineHeight: 1.5 }]}>{recommendation.headline}</Text>

        <View style={[s.row, { marginTop: 12, marginBottom: 12 }]}>
          <View style={s.statBox}>
            <Text style={s.statLabel}>TWELVE-MONTH COST</Text>
            <Text style={s.statValue}>{money(recommendation.primary.twelveMonthTotalUsd)}</Text>
            <Text style={s.small}>
              {money(scenario.bands.conservative.annualCreditCostUsd)} –{' '}
              {money(scenario.bands.aggressive.annualCreditCostUsd)} credit cost band
            </Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statLabel}>SAVING VS DOING NOTHING</Text>
            <Text style={[s.statValue, { color: OK }]}>
              {money(recommendation.annualSavingVsNaivePaygUsd)}
            </Text>
            <Text style={s.small}>
              Unmanaged pay-as-you-go: {money(payg?.twelveMonthTotalUsd ?? 0)}
            </Text>
          </View>
          <View style={[s.statBox, { marginRight: 0 }]}>
            <Text style={s.statLabel}>COMMITMENT ASKED FOR</Text>
            <Text style={s.statValue}>
              {primary && primary.commitmentLockInMonths > 0
                ? `${primary.commitmentLockInMonths} months`
                : 'None'}
            </Text>
            <Text style={s.small}>
              Reversibility: {primary?.reversibility ?? 'n/a'}
            </Text>
          </View>
        </View>

        <Text style={s.h3}>What we are asking you to approve</Text>
        <Text style={s.p}>
          Adopt <Text style={{ fontFamily: 'Helvetica-Bold' }}>{recommendation.primary.label}</Text>{' '}
          as the funding route for Copilot consumption, at an expected{' '}
          {money(cost.totalMonthlyUsd)} a month, and review it at the ninety-day true-up before any
          longer commitment is signed.
        </Text>

        <Text style={s.h3}>The three risks that matter</Text>
        <Bullets items={result.risks.slice(0, 3).map((r) => `${r.title} — ${r.description}`)} />

        <Text style={s.h3}>Why not simply do nothing</Text>
        <Text style={s.p}>
          Consumption happens whether or not it is funded deliberately. On current assumptions the
          organisation would spend {money(payg?.twelveMonthTotalUsd ?? 0)} over twelve months at
          unmanaged rates. The recommendation does not increase usage; it changes how the same usage
          is paid for.
        </Text>

        <Text style={s.h3}>Confidence</Text>
        <Text style={s.p}>
          {recommendation.confidenceChip}. Twelve-month volume varies by a coefficient of{' '}
          {scenario.coefficientOfVariation.toFixed(2)} across the modelled band, and the figures
          rest on assumptions listed in the technical appendix rather than on measured telemetry.
        </Text>
        <Footer />
      </Page>

      {/* 3 — Recommendation & rationale */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>RECOMMENDATION &amp; RATIONALE</Text>
        <Text style={s.h2}>{recommendation.primary.label}</Text>
        <Text style={s.p}>{primary?.summary}</Text>

        <Text style={s.h3}>Primary and alternatives</Text>
        <Table
          cols={['Option', '12-month total', 'Δ vs primary', 'Trade-off']}
          widths={[24, 15, 14, 47]}
          aligns={['left', 'right', 'right', 'left']}
          rows={[recommendation.primary, ...recommendation.alternatives].map((o) => [
            o.label,
            money(o.twelveMonthTotalUsd),
            o.deltaVsPrimaryUsd === 0 ? '—' : money(o.deltaVsPrimaryUsd),
            o.tradeOff,
          ])}
        />

        <Text style={s.h3}>Decision criteria — what fired and what did not</Text>
        <Table
          cols={['Criterion', 'Fired', 'Reason', 'Effect']}
          widths={[16, 8, 40, 36]}
          rows={recommendation.rules.map((r) => [
            r.name,
            r.fired ? 'yes' : 'no',
            r.reason,
            r.fired ? r.effect : '—',
          ])}
        />

        {recommendation.safetyNet ? (
          <>
            <Text style={s.h3}>Safety net</Text>
            <Text style={s.p}>{recommendation.safetyNet}</Text>
          </>
        ) : null}

        <Text style={s.h3}>Governance actions that apply whichever option is chosen</Text>
        <Bullets items={recommendation.governanceActions} />
        <Footer />
      </Page>

      {/* 4 — Financial model */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>FINANCIAL MODEL</Text>
        <Text style={s.h2}>Twelve-month cash flow</Text>
        <Table
          cols={['Month', 'Conservative cr', 'Expected cr', 'Aggressive cr', 'Expected cost']}
          widths={[20, 20, 20, 20, 20]}
          aligns={['left', 'right', 'right', 'right', 'right']}
          rows={scenario.months.map((m) => [
            m.label,
            int(m.conservativeCredits),
            int(m.expectedCredits),
            int(m.aggressiveCredits),
            money(m.expectedCredits * cost.effectiveUsdPerCredit),
          ])}
        />

        <Text style={s.h3}>Credit waterfall (monthly)</Text>
        <Table
          cols={['Stage', 'Credits']}
          widths={[70, 30]}
          aligns={['left', 'right']}
          rows={[
            ['Gross credits generated', int(credits.grossCredits)],
            ['Less: offset by Microsoft 365 Copilot licences', `−${int(credits.offsetCredits)}`],
            ['Billable Copilot Credits (Microsoft meter)', int(credits.billableCredits)],
            ['— internal', int(credits.internalBillableCredits)],
            ['— external / customer-facing (never offsettable)', int(credits.externalBillableCredits)],
            ...(credits.otherMeterBillableCredits > 0
              ? credits.byCurrency
                  .filter((c) => c.currency !== 'microsoft-copilot-credit')
                  .map(
                    (c) =>
                      [`${c.label}s — billed by ${c.meter}, not fundable by any Microsoft vehicle`, int(c.billableCredits)] as [
                        string,
                        string,
                      ],
                  )
              : []),
          ]}
        />

        <Text style={s.h3}>Effective cost per credit by option</Text>
        <Table
          cols={['Option', '12-month', '$/credit', 'Waste', 'Shortfall', 'Eligible']}
          widths={[30, 16, 14, 13, 13, 14]}
          aligns={['left', 'right', 'right', 'right', 'right', 'left']}
          rows={fundingOptions.map((o) => [
            o.label,
            money(o.twelveMonthTotalUsd),
            money2(o.effectiveUsdPerCredit),
            pc(o.wastePctOfPurchased),
            pc(o.shortfallRiskPct),
            o.eligible ? 'yes' : 'no',
          ])}
        />

        <Text style={s.h3}>Sensitivity — what moves the number</Text>
        <Table
          cols={['Input', 'Low total', 'High total', 'Swing', 'Swing %']}
          widths={[40, 15, 15, 15, 15]}
          aligns={['left', 'right', 'right', 'right', 'right']}
          rows={result.sensitivity.map((x) => [
            x.label,
            money(x.lowTotalUsd),
            money(x.highTotalUsd),
            money(x.swingUsd),
            pc(x.swingPct),
          ])}
        />
        <Footer />
      </Page>

      {/* 5 — Technical appendix */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>TECHNICAL APPENDIX</Text>
        <Text style={s.h2}>Volume to credits, per workload</Text>
        <Table
          cols={['Workload', 'Driver', 'Units/mo', 'Cr/unit', 'Gross', 'Offset', 'Billable', 'Meter']}
          widths={[16, 22, 11, 8, 11, 10, 11, 11]}
          aligns={['left', 'left', 'right', 'right', 'right', 'right', 'right', 'left']}
          rows={credits.lines.map((l) => [
            workloadMeta(l.workloadId).label,
            l.label,
            int(l.quantity),
            l.creditsPerUnit.toFixed(2),
            int(l.grossCredits),
            int(l.offsetCredits),
            int(l.billableCredits),
            l.currency === 'microsoft-copilot-credit' ? 'Microsoft' : 'GitHub',
          ])}
        />

        <Text style={s.h3}>Licence-offset arithmetic</Text>
        <Text style={s.p}>{licenceBreakEven.narrative}</Text>
        <Table
          cols={['Quantity', 'Value']}
          widths={[70, 30]}
          aligns={['left', 'right']}
          rows={[
            ['Microsoft 365 Copilot seat, monthly', money2(licenceBreakEven.seatMonthlyUsd)],
            ['Break-even credits at pay-as-you-go', int(licenceBreakEven.breakEvenCreditsAtPayg)],
            ['Break-even credits at capacity pack rate', int(licenceBreakEven.breakEvenCreditsAtPackRate)],
            ['Internal users', int(licenceBreakEven.internalUsers)],
            ['Already licensed', int(licenceBreakEven.licensedInternalUsers)],
            ['Unlicensed', int(licenceBreakEven.unlicensedInternalUsers)],
            ['Unlicensed users above break-even', int(licenceBreakEven.usersAboveBreakEven)],
            ['Share above break-even', pc(licenceBreakEven.shareOfUsersAboveBreakEvenPct)],
            ['Annual metered spend removed', money(licenceBreakEven.annualMeteredSpendRemovedUsd)],
            ['Annual seat cost of the shift', money(licenceBreakEven.annualSeatCostUsd)],
            ['Annual net benefit', money(licenceBreakEven.annualNetBenefitUsd)],
            ['Worth doing on these numbers', licenceBreakEven.worthwhile ? 'yes' : 'no'],
          ]}
        />
        <Footer />
      </Page>

      {/* 5b — Rate card */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>TECHNICAL APPENDIX</Text>
        <Text style={s.h2}>Rate card {card.version}</Text>
        <Text style={[s.p, s.muted]}>
          Effective {card.effectiveDate}. Rows marked ESTIMATE are not published by Microsoft and are
          modelled — treat them as assumptions to verify, not as prices.
        </Text>
        <Table
          cols={['Consumption rate', 'Credits', 'Unit', 'Offsettable', 'Verified']}
          widths={[36, 12, 24, 14, 14]}
          aligns={['left', 'right', 'left', 'left', 'left']}
          rows={Object.values(card.consumption).map((r) => [
            r.label,
            r.credits.toFixed(2),
            r.unit,
            r.offsetByM365CopilotLicence ? 'yes' : 'no',
            r.verified ? 'verified' : 'ESTIMATE',
          ])}
        />
        <Text style={s.h3}>Commercial rates</Text>
        <Table
          cols={['Item', 'Value', 'Verified']}
          widths={[58, 26, 16]}
          aligns={['left', 'right', 'left']}
          rows={[
            [
              card.commercial.paygCreditUsd.label,
              money2(card.commercial.paygCreditUsd.value),
              card.commercial.paygCreditUsd.verified ? 'verified' : 'ESTIMATE',
            ],
            [
              card.commercial.m365CopilotSeatMonthlyUsd.label,
              money2(card.commercial.m365CopilotSeatMonthlyUsd.value),
              card.commercial.m365CopilotSeatMonthlyUsd.verified ? 'verified' : 'ESTIMATE',
            ],
            [
              `${card.commercial.capacityPack.label} (${int(card.commercial.capacityPack.credits)} credits)`,
              `${money(card.commercial.capacityPack.monthlyUsd)} / mo`,
              card.commercial.capacityPack.verified ? 'verified' : 'ESTIMATE',
            ],
            [
              'Capacity pack effective rate',
              money2(card.commercial.capacityPack.effectiveUsdPerCredit),
              card.commercial.capacityPack.verified ? 'verified' : 'ESTIMATE',
            ],
            [
              `${card.p3PrePurchasePlan.label} — retail paid down per commit unit`,
              money2(card.p3PrePurchasePlan.usdRetailPaidDownPerCommitUnit),
              'verified',
            ],
          ]}
        />
        <Text style={s.h3}>Sources</Text>
        {Object.values(card.consumption)
          .filter((r, i, a) => a.findIndex((x) => x.sourceUrl === r.sourceUrl) === i)
          .map((r) => (
            <Text key={r.sourceUrl} style={s.small}>
              {r.sourceUrl}
            </Text>
          ))}
        <Footer />
      </Page>

      {/* 5c — Audit trail */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>TECHNICAL APPENDIX</Text>
        <Text style={s.h2}>Audit trail — {result.audit.length} steps</Text>
        <Text style={[s.p, s.muted]}>
          Every figure in this document derives from one of the lines below. Nothing is asserted
          without the arithmetic that produced it.
        </Text>
        <Table
          cols={['Step', 'Formula', 'Output', 'Unit']}
          widths={[19, 50, 17, 14]}
          aligns={['left', 'left', 'right', 'left']}
          rows={result.audit.map((e) => [
            e.step,
            e.formula,
            e.output.toLocaleString('en-US', { maximumFractionDigits: 3 }),
            e.outputUnit,
          ])}
        />
        <Footer />
      </Page>

      {/* 6 — Roadmap */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>IMPLEMENTATION ROADMAP</Text>
        <Text style={s.h2}>Thirty, sixty, ninety days</Text>
        {ROADMAP.map((phase) => (
          <View key={phase.window} wrap={false}>
            <Text style={s.h3}>{phase.window}</Text>
            <Bullets items={phase.actions} />
          </View>
        ))}
        <Footer />
      </Page>

      {/* 7 — Risk register */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>RISK &amp; GOVERNANCE REGISTER</Text>
        <Text style={s.h2}>What could go wrong, and what to do about it</Text>
        <Table
          cols={['Risk', 'Severity', 'Description', 'Mitigation']}
          widths={[19, 10, 36, 35]}
          rows={result.risks.map((r) => [r.title, r.severity, r.description, r.mitigation])}
        />
        <Text style={s.h3}>Standing exposures</Text>
        <Table
          cols={['Exposure', 'Position on current answers']}
          widths={[34, 66]}
          rows={[
            [
              'Shortfall risk',
              `${pc(primary?.shortfallRiskPct ?? 0)} on the recommended option; overage falls back to pay-as-you-go rates.`,
            ],
            [
              'Non-cancellable commitment',
              card.p3PrePurchasePlan.cancellable
                ? 'Pre-purchase plans are cancellable on current terms — verify in contract.'
                : 'Pre-purchase plans are NOT cancellable. Any P3 commitment is sunk for the term.',
            ],
            [
              'Monthly pack expiry waste',
              card.commercial.capacityPack.rollsOver
                ? 'Capacity pack credits roll over.'
                : `Capacity pack credits do NOT roll over and reset on day ${card.commercial.capacityPack.resetDayOfMonth}. Modelled waste on the recommended option is ${money(primary?.wasteUsd ?? 0)}.`,
            ],
            [
              'External traffic exposure',
              `${int(licenceBreakEven.externalCreditsNeverOffsettable)} credits a month (${money(licenceBreakEven.externalMonthlyCostUsd)}) are customer-facing and can never be offset by licences.`,
            ],
            [
              'Rate-change exposure',
              `All figures use rate card ${card.version} effective ${card.effectiveDate}. Microsoft changes these rates without notice; re-run before signing.`,
            ],
            [
              'Tenant vs environment allocation',
              'Credits pool at tenant level by default. Without environment-level allocation policies a single project can consume the whole pool.',
            ],
          ]}
        />
        <Footer />
      </Page>

      {/* 8 — Negotiation brief + 9 benchmark + 10 disclaimer */}
      <Page size="A4" style={s.page}>
        <Text style={s.kicker}>NEGOTIATION BRIEF</Text>
        <Text style={s.h2}>Questions to put to your Microsoft account team</Text>
        <Bullets items={NEGOTIATION_QUESTIONS} />

        <View style={s.rule} />
        <Text style={s.kicker}>BENCHMARK CONTEXT</Text>
        <Text style={s.h2}>Where this organisation sits</Text>
        <Table
          cols={['Measure', 'This organisation']}
          widths={[62, 38]}
          aligns={['left', 'right']}
          rows={[
            [
              'Billable credits per knowledge worker per month',
              (credits.billableCredits / Math.max(answers.profile.knowledgeWorkers, 1)).toFixed(1),
            ],
            [
              'Cost per knowledge worker per month',
              money2(cost.totalMonthlyUsd / Math.max(answers.profile.knowledgeWorkers, 1)),
            ],
            ['Workloads in scope', String(answers.workloads.length)],
            ['Volatility (coefficient of variation)', scenario.coefficientOfVariation.toFixed(2)],
          ]}
        />
        <Text style={[s.small, { marginTop: 6 }]}>
          Cohort percentiles are published in the web application only where at least five
          organisations have contributed to a cohort. Where that threshold is not met, no comparison
          is shown rather than an unreliable one.
        </Text>

        <View style={s.rule} />
        <Text style={s.kicker}>METHODOLOGY &amp; DISCLAIMER</Text>
        <Text style={s.p}>
          Volumes are derived from the answers given, converted to credits using the published
          consumption rates in rate card {card.version}, reduced by the Microsoft 365 Copilot licence
          offset where the rate is offset-eligible, then projected over twelve months with an
          adoption ramp and a seasonality profile. Scenario bands apply confidence multipliers of{' '}
          {scenario.bands.conservative.multiplier}× / {scenario.bands.expected.multiplier}× /{' '}
          {scenario.bands.aggressive.multiplier}×. Funding options are costed on identical volume so
          that the comparison is like for like.
        </Text>
        <Text style={[s.p, { color: WARN }]}>
          This is a planning estimate produced from assumptions, not measurements. It is not a
          quotation and it is not a Microsoft document.
        </Text>
        <Text style={s.small}>{DISCLAIMER}</Text>
        <Footer />
      </Page>
    </Document>
  );

  return pdf(doc).toBlob();
}
