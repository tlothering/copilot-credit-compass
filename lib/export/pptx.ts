import type { ExportInput } from './index';
import type { FundingOptionId } from '../engine/types';
import { workloadMeta } from '@/lib/schemas/taxonomy';
import { DISCLAIMER } from './copy';

const BG = '0B1017';
const CARD = '141C26';
const INK = 'F2F6FA';
const MUTED = '9AA9B8';
const ACCENT = '4F8CF5';
const OK = '3FBF87';
const WARN = 'E0A44A';

const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const int = (v: number) => Math.round(v).toLocaleString('en-US');
const pc = (v: number) => `${v.toFixed(1)}%`;

export async function buildPptx({ answers, result }: ExportInput): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const p = new PptxGenJS();

  p.layout = 'LAYOUT_16x9';
  p.author = 'Copilot Credit Compass';
  p.title = 'Microsoft Copilot Credit & Funding Assessment';

  p.defineSlideMaster({
    title: 'CCC',
    background: { color: BG },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.06, fill: { color: ACCENT } } },
      {
        text: {
          text: `Rate card ${result.rateCardVersion} · effective ${result.rateCardEffectiveDate} · planning estimate, not a Microsoft quotation`,
          options: {
            x: 0.4,
            y: 5.06,
            w: 9.2,
            h: 0.3,
            fontSize: 8,
            color: MUTED,
            align: 'left',
          },
        },
      },
    ],
    slideNumber: { x: 9.3, y: 5.06, fontSize: 8, color: MUTED },
  });

  const { credits, cost, scenario, recommendation, licenceBreakEven, fundingOptions } = result;
  const payg = fundingOptions.find((o) => o.id === 'payg');
  const primary = fundingOptions.find((o) => o.id === recommendation.primary.optionId);

  const title = (slide: ReturnType<typeof p.addSlide>, kicker: string, heading: string) => {
    slide.addText(kicker.toUpperCase(), {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.25,
      fontSize: 10,
      bold: true,
      color: ACCENT,
      charSpacing: 2,
    });
    slide.addText(heading, {
      x: 0.5,
      y: 0.55,
      w: 9,
      h: 0.6,
      fontSize: 26,
      bold: true,
      color: INK,
    });
  };

  const stat = (
    slide: ReturnType<typeof p.addSlide>,
    x: number,
    label: string,
    value: string,
    sub: string,
    colour = INK,
  ) => {
    slide.addShape(p.ShapeType.roundRect, {
      x,
      y: 1.45,
      w: 2.1,
      h: 1.35,
      fill: { color: CARD },
      line: { color: '25313F', width: 1 },
      rectRadius: 0.08,
    });
    slide.addText(label.toUpperCase(), {
      x: x + 0.15,
      y: 1.58,
      w: 1.8,
      h: 0.25,
      fontSize: 8,
      color: MUTED,
      charSpacing: 1,
    });
    slide.addText(value, {
      x: x + 0.15,
      y: 1.82,
      w: 1.85,
      h: 0.42,
      fontSize: 19,
      bold: true,
      color: colour,
    });
    slide.addText(sub, {
      x: x + 0.15,
      y: 2.26,
      w: 1.85,
      h: 0.45,
      fontSize: 8,
      color: MUTED,
    });
  };

  const tableOpts = {
    x: 0.5,
    w: 9,
    fontSize: 10,
    color: INK,
    border: { type: 'solid' as const, pt: 0.5, color: '25313F' },
    fill: { color: CARD },
    autoPage: false,
  };
  const head = (cells: string[]) =>
    cells.map((t) => ({
      text: t,
      options: { bold: true, color: BG, fill: { color: ACCENT }, fontSize: 10 },
    }));

  /* ------------------------------------------------------ 1 — Title */
  const s1 = p.addSlide({ masterName: 'CCC' });
  s1.addText('COPILOT CREDIT COMPASS', {
    x: 0.6,
    y: 1.5,
    w: 9,
    h: 0.3,
    fontSize: 11,
    bold: true,
    color: ACCENT,
    charSpacing: 3,
  });
  s1.addText('Microsoft Copilot\nCredit & Funding Assessment', {
    x: 0.6,
    y: 1.85,
    w: 9,
    h: 1.5,
    fontSize: 36,
    bold: true,
    color: INK,
    lineSpacingMultiple: 1.05,
  });
  s1.addText(
    `${answers.profile.industry} · ${answers.profile.employeeBand} employees · ${int(answers.profile.knowledgeWorkers)} knowledge workers · ${answers.workloads.length} workloads · ${new Date().toISOString().slice(0, 10)}`,
    { x: 0.6, y: 3.5, w: 9, h: 0.4, fontSize: 12, color: MUTED },
  );

  /* -------------------------------------------- 2 — The recommendation */
  const s2 = p.addSlide({ masterName: 'CCC' });
  title(
    s2,
    'The recommendation',
    recommendation.noDecisionRequired
      ? 'No Microsoft credit funding decision required'
      : recommendation.primary.label,
  );
  stat(s2, 0.5, '12-month cost', money(recommendation.primary.twelveMonthTotalUsd), primary ? `${primary.cashFlowShape} cash flow` : '');
  stat(
    s2,
    2.75,
    'Saving vs unmanaged',
    money(recommendation.annualSavingVsNaivePaygUsd),
    `Pay-as-you-go would be ${money(payg?.twelveMonthTotalUsd ?? 0)}`,
    OK,
  );
  stat(s2, 5.0, 'Monthly run rate', money(cost.totalMonthlyUsd), `${int(credits.billableCredits)} billable credits`);
  stat(
    s2,
    7.25,
    'Commitment',
    primary && primary.commitmentLockInMonths > 0 ? `${primary.commitmentLockInMonths} mo` : 'None',
    `Reversibility: ${primary?.reversibility ?? 'n/a'}`,
    primary && primary.commitmentLockInMonths > 0 ? WARN : OK,
  );
  s2.addText(recommendation.headline, {
    x: 0.5,
    y: 3.0,
    w: 9,
    h: 1.1,
    fontSize: 13,
    color: INK,
    lineSpacingMultiple: 1.25,
  });
  s2.addText(`Confidence: ${recommendation.confidenceChip}`, {
    x: 0.5,
    y: 4.15,
    w: 9,
    h: 0.3,
    fontSize: 10,
    color: MUTED,
  });

  /* ------------------------------------------------ 3 — Where it goes */
  const s3 = p.addSlide({ masterName: 'CCC' });
  title(s3, 'Where the money goes', 'From raw activity to billable credits');
  const flowRows: string[][] = [
    ['Gross credits generated', int(credits.grossCredits), money(credits.grossCredits * cost.effectiveUsdPerCredit)],
    ['Less: Microsoft 365 Copilot licence offset', `−${int(credits.offsetCredits)}`, `−${money(credits.offsetCredits * cost.effectiveUsdPerCredit)}`],
    ['Billable Copilot Credits (Microsoft meter)', int(credits.billableCredits), money(cost.meteredCreditCostUsd)],
    ['  of which internal', int(credits.internalBillableCredits), ''],
    ['  of which customer-facing', int(credits.externalBillableCredits), ''],
    ['Platform and seat costs', '—', money(cost.platformMonthlyUsd)],
  ];
  // Broken out as a sub-line of platform cost, where it is already counted — it bills on
  // its own meter and no Microsoft funding vehicle can pay it.
  if (credits.otherMeterCostUsd > 0) {
    for (const c of credits.byCurrency) {
      if (c.currency === 'microsoft-copilot-credit') continue;
      flowRows.push([
        `  of which ${c.label}s, billed by ${c.meter}`,
        int(c.billableCredits),
        money(c.billableCostUsd),
      ]);
    }
  }
  flowRows.push(['Total monthly', '', money(cost.totalMonthlyUsd)]);
  const billableIdx = 2;
  const totalIdx = flowRows.length - 1;
  s3.addTable(
    [
      head(['Stage', 'Credits / month', 'At effective rate']),
      ...flowRows.map((r, i) =>
        r.map((t, ci) => ({
          text: t,
          options: {
            bold: i === totalIdx || i === billableIdx,
            color: i === totalIdx ? ACCENT : INK,
            align: ci === 0 ? ('left' as const) : ('right' as const),
            fontSize: 10,
          },
        })),
      ),
    ],
    { ...tableOpts, y: 1.4, colW: [4.5, 2.25, 2.25] },
  );
  s3.addText(
    `Top workloads by billable credits: ${credits.byWorkload
      .slice()
      .sort((a, b) => b.billableCredits - a.billableCredits)
      .slice(0, 3)
      .map((w) => `${workloadMeta(w.workloadId).label} (${int(w.billableCredits)})`)
      .join(' · ')}`,
    { x: 0.5, y: 4.35, w: 9, h: 0.35, fontSize: 9, color: MUTED },
  );

  /* -------------------------------------------------- 4 — The options */
  const s4 = p.addSlide({ masterName: 'CCC' });
  title(s4, 'The options', 'Eight routes, costed on identical volume');
  // Structural eligibility is not the whole verdict: an option can be perfectly buyable
  // and still be disqualified by a recommendation rule. "Do nothing" is the dangerous
  // case — it is always buyable and often carries the lowest figure in the table, so
  // labelling it eligible invites a reader to pick the cheapest row and be badly wrong.
  const rankedById = new Map(recommendation.ranked.map((r) => [r.optionId, r]));
  const isBlocked = (id: FundingOptionId) =>
    rankedById.get(id)?.blocked ?? false;
  s4.addTable(
    [
      head(['Option', '12-month', '$/credit', 'Waste', 'Shortfall', 'Lock-in', 'Candidate']),
      ...fundingOptions.map((o) =>
        [
          o.label,
          money(o.twelveMonthTotalUsd),
          `$${o.effectiveUsdPerCredit.toFixed(3)}`,
          pc(o.wastePctOfPurchased),
          pc(o.shortfallRiskPct),
          o.commitmentLockInMonths ? `${o.commitmentLockInMonths} mo` : '—',
          isBlocked(o.id) ? 'no' : 'yes',
        ].map((t, ci) => ({
          text: t,
          options: {
            fontSize: 9,
            bold: o.id === recommendation.primary.optionId,
            color: isBlocked(o.id)
              ? MUTED
              : o.id === recommendation.primary.optionId
                ? ACCENT
                : INK,
            align: ci === 0 || ci === 6 ? ('left' as const) : ('right' as const),
          },
        })),
      ),
    ],
    { ...tableOpts, y: 1.35, colW: [2.7, 1.3, 1.1, 1.0, 1.1, 0.9, 0.9] },
  );

  /* ---------------------------------------------- 5 — Licence offset */
  const s5 = p.addSlide({ masterName: 'CCC' });
  title(s5, 'The biggest lever', 'Licence offset break-even');
  stat(
    s5,
    0.5,
    'Break-even (PAYG)',
    `${int(licenceBreakEven.breakEvenCreditsAtPayg)} cr`,
    `${money(licenceBreakEven.seatMonthlyUsd)} seat ÷ pay-as-you-go rate`,
  );
  stat(
    s5,
    2.75,
    'Break-even (pack)',
    `${int(licenceBreakEven.breakEvenCreditsAtPackRate)} cr`,
    'Cheaper credits raise the bar',
  );
  stat(
    s5,
    5.0,
    'Users above the line',
    `${int(licenceBreakEven.usersAboveBreakEven)}`,
    `${pc(licenceBreakEven.shareOfUsersAboveBreakEvenPct)} of ${int(licenceBreakEven.unlicensedInternalUsers)} unlicensed`,
  );
  stat(
    s5,
    7.25,
    'Annual net benefit',
    money(licenceBreakEven.annualNetBenefitUsd),
    licenceBreakEven.worthwhile ? 'Worth doing' : 'Not worth doing yet',
    licenceBreakEven.worthwhile ? OK : WARN,
  );
  s5.addText(licenceBreakEven.narrative, {
    x: 0.5,
    y: 3.0,
    w: 9,
    h: 1.2,
    fontSize: 11,
    color: INK,
    lineSpacingMultiple: 1.25,
  });

  /* ------------------------------------------------- 6 — Risks & next */
  const s6 = p.addSlide({ masterName: 'CCC' });
  title(s6, 'Risks and next steps', 'What we are asking you to approve');
  s6.addText(
    [
      {
        text: recommendation.noDecisionRequired
          ? `No credit funding instrument to approve — there is no Microsoft Copilot Credit demand for one to fund. Confirm the estate assumptions and revisit if Microsoft Copilot workloads are introduced.`
          : `Approve ${recommendation.primary.label} at ${money(recommendation.primary.twelveMonthTotalUsd)} over twelve months, reviewed at the ninety-day true-up.`,
        options: { bullet: true, color: INK, fontSize: 12, breakLine: true },
      },
      ...result.risks.slice(0, 4).map((r) => ({
        text: `${r.title} (${r.severity}) — ${r.mitigation}`,
        options: {
          bullet: true,
          color: r.severity === 'high' ? WARN : MUTED,
          fontSize: 10,
          breakLine: true,
        },
      })),
      ...recommendation.governanceActions.slice(0, 3).map((a) => ({
        text: a,
        options: { bullet: true, color: MUTED, fontSize: 10, breakLine: true },
      })),
    ],
    { x: 0.5, y: 1.35, w: 9, h: 3.4, lineSpacingMultiple: 1.15 },
  );

  /* ------------------------------------------------- 7 — Disclaimer */
  const s7 = p.addSlide({ masterName: 'CCC' });
  title(s7, 'Basis of these numbers', 'Methodology and disclaimer');
  s7.addText(
    `Volumes derive from the answers given, converted to credits using rate card ${result.rateCardVersion} (effective ${result.rateCardEffectiveDate}), reduced by the Microsoft 365 Copilot licence offset where the rate is offset-eligible, then projected over twelve months with an adoption ramp and seasonality. Scenario bands apply ${scenario.bands.conservative.multiplier}× / ${scenario.bands.expected.multiplier}× / ${scenario.bands.aggressive.multiplier}× multipliers. All eight funding options are costed on identical volume. The full audit trail — ${result.audit.length} steps — is in the PDF and XLSX exports.`,
    { x: 0.5, y: 1.35, w: 9, h: 1.6, fontSize: 11, color: INK, lineSpacingMultiple: 1.3 },
  );
  s7.addText(DISCLAIMER, {
    x: 0.5,
    y: 3.1,
    w: 9,
    h: 1.4,
    fontSize: 9,
    color: MUTED,
    lineSpacingMultiple: 1.25,
  });

  const blob = (await p.write({ outputType: 'blob' })) as Blob;
  return blob;
}
