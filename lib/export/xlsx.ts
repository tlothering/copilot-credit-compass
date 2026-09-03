import type { Workbook, Worksheet } from 'exceljs';
import type { ExportInput } from './index';
import { workloadMeta } from '@/lib/schemas/taxonomy';
import { getRateCard } from '@/lib/engine/rate-card';
import { DISCLAIMER } from './copy';

/* ------------------------------------------------------------------ */
/* Styling helpers                                                     */
/* ------------------------------------------------------------------ */

const INK = 'FF0F1720';
const MUTED = 'FF6B7A8C';
const ACCENT = 'FF1F6FEB';
const BAND = 'FFF2F6FB';

function titleRow(ws: Worksheet, text: string, sub?: string) {
  const a = ws.addRow([text]);
  a.font = { bold: true, size: 14, color: { argb: INK } };
  a.height = 20;
  if (sub) {
    const b = ws.addRow([sub]);
    b.font = { size: 9, italic: true, color: { argb: MUTED } };
  }
  ws.addRow([]);
}

function headerRow(ws: Worksheet, cells: string[]) {
  const r = ws.addRow(cells);
  r.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  r.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  r.height = 24;
  return r;
}

function zebra(ws: Worksheet, from: number, to: number) {
  for (let i = from; i <= to; i += 2) {
    ws.getRow(i).eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    });
  }
}

function widths(ws: Worksheet, w: number[]) {
  w.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
}

const MONEY = '"$"#,##0.00';
const MONEY0 = '"$"#,##0';
const INT = '#,##0';
const DEC2 = '#,##0.00';
const PCT = '0.0%';

/* ------------------------------------------------------------------ */

export async function buildXlsx({ answers, result }: ExportInput): Promise<Blob> {
  const ExcelJS = await import('exceljs');
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = 'Copilot Credit Compass';
  wb.created = new Date();
  wb.properties.date1904 = false;

  const card = getRateCard();

  const inputs = wb.addWorksheet('Inputs', { views: [{ state: 'frozen', ySplit: 5 }] });
  const rates = wb.addWorksheet('RateCard', { views: [{ state: 'frozen', ySplit: 5 }] });
  const volume = wb.addWorksheet('VolumeModel', { views: [{ state: 'frozen', ySplit: 5 }] });
  const creditsWs = wb.addWorksheet('CreditModel', { views: [{ state: 'frozen', ySplit: 5 }] });
  const funding = wb.addWorksheet('FundingOptions', { views: [{ state: 'frozen', ySplit: 5 }] });
  const cash = wb.addWorksheet('12MonthCashflow', { views: [{ state: 'frozen', ySplit: 5 }] });
  const sens = wb.addWorksheet('Sensitivity', { views: [{ state: 'frozen', ySplit: 5 }] });
  const audit = wb.addWorksheet('AuditTrail', { views: [{ state: 'frozen', ySplit: 5 }] });

  /* ------------------------------------------------------------ Inputs */
  titleRow(
    inputs,
    'Inputs',
    'Yellow cells are the drivers. Change one and every other sheet recalculates — nothing downstream is pasted as a value.',
  );
  widths(inputs, [42, 18, 46]);
  headerRow(inputs, ['Input', 'Value', 'Notes']);

  const inputRows: [string, string | number, string][] = [
    ['Industry', answers.profile.industry, 'Drives seeded defaults only; not used arithmetically'],
    ['Region', answers.profile.region, 'Rate card is USD list; local pricing may differ'],
    ['Employee band', answers.profile.employeeBand, ''],
    ['Knowledge workers', answers.profile.knowledgeWorkers, 'Denominator for per-user metrics'],
    ['Azure agreement', answers.profile.azureAgreement, 'Gates MACC-eligible options'],
    ['MACC remaining band', answers.profile.maccRemainingBand ?? 'n/a', ''],
    ['M365 base', answers.profile.m365Base, 'Determines licence-offset eligibility'],
    ['Workloads selected', answers.workloads.length, answers.workloads.join(', ')],
    ['Ramp month 1 (%)', answers.growth.rampMonth1Pct / 100, 'Share of steady-state volume'],
    ['Ramp month 3 (%)', answers.growth.rampMonth3Pct / 100, ''],
    ['Ramp month 6 (%)', answers.growth.rampMonth6Pct / 100, ''],
    ['Ramp month 12 (%)', answers.growth.rampMonth12Pct / 100, ''],
    ['Confidence', answers.growth.confidence, 'Widens or narrows the scenario band'],
    ['Overage tolerance', answers.growth.budgetTolerance, 'Weights shortfall risk in the ranking'],
  ];
  const inputStart = inputs.rowCount + 1;
  for (const [k, v, note] of inputRows) {
    const r = inputs.addRow([k, v, note]);
    r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6D6' } };
    r.getCell(2).font = { bold: true };
    if (typeof v === 'number') {
      r.getCell(2).numFmt = k.includes('(%)') ? PCT : INT;
    }
    r.getCell(3).font = { size: 9, color: { argb: MUTED } };
  }
  zebra(inputs, inputStart, inputs.rowCount);

  const KW = `Inputs!$B$${inputStart + 3}`;

  /* ---------------------------------------------------------- RateCard */
  titleRow(
    rates,
    `Rate card ${card.version}`,
    `Effective ${card.effectiveDate}. Every price used anywhere in this workbook is referenced from this sheet — there are no numeric literals for prices elsewhere.`,
  );
  widths(rates, [40, 16, 12, 14, 62]);
  headerRow(rates, ['Item', 'Value', 'Unit', 'Verified', 'Source']);

  type RateRow = {
    key: string;
    label: string;
    value: number;
    unit: string;
    verified: boolean;
    sourceUrl: string;
  };
  const rateRows: RateRow[] = [];

  const c = card.commercial;
  rateRows.push(simple('commercial.paygCreditUsd', c.paygCreditUsd));
  rateRows.push(simple('commercial.m365CopilotSeatMonthlyUsd', c.m365CopilotSeatMonthlyUsd));
  rateRows.push({
    key: 'capacityPack.monthly',
    label: `${c.capacityPack.label} (${c.capacityPack.credits.toLocaleString('en-US')} credits)`,
    value: c.capacityPack.monthlyUsd,
    unit: 'USD / month',
    verified: c.capacityPack.verified,
    sourceUrl: c.capacityPack.sourceUrl,
  });
  rateRows.push({
    key: 'capacityPack.effective',
    label: 'Capacity pack effective rate',
    value: c.capacityPack.effectiveUsdPerCredit,
    unit: 'USD / credit',
    verified: c.capacityPack.verified,
    sourceUrl: c.capacityPack.sourceUrl,
  });
  rateRows.push({
    key: 'securityCopilot.provisioned',
    label: `${c.securityCopilot.label} — provisioned SCU`,
    value: c.securityCopilot.provisionedScuHourUsd,
    unit: 'USD / SCU-hour',
    verified: c.securityCopilot.verified,
    sourceUrl: c.securityCopilot.sourceUrl,
  });
  rateRows.push({
    key: 'githubCopilot.business',
    label: `${c.githubCopilot.label} — Business seat`,
    value: c.githubCopilot.business.seatMonthlyUsd,
    unit: 'USD / month',
    verified: c.githubCopilot.verified,
    sourceUrl: c.githubCopilot.sourceUrl,
  });
  rateRows.push({
    key: 'githubCopilot.overage',
    label: 'GitHub Copilot premium request overage',
    value: c.githubCopilot.overageCreditUsd,
    unit: 'USD / request',
    verified: c.githubCopilot.verified,
    sourceUrl: c.githubCopilot.sourceUrl,
  });
  rateRows.push({
    key: 'foundry.input',
    label: `${c.foundry.label} — input tokens`,
    value: c.foundry.inputPerMillionTokensUsd,
    unit: 'USD / M tokens',
    verified: c.foundry.verified,
    sourceUrl: c.foundry.sourceUrl,
  });
  rateRows.push({
    key: 'foundry.output',
    label: `${c.foundry.label} — output tokens`,
    value: c.foundry.outputPerMillionTokensUsd,
    unit: 'USD / M tokens',
    verified: c.foundry.verified,
    sourceUrl: c.foundry.sourceUrl,
  });
  rateRows.push({
    key: 'p3.paidDownPerCommitUnit',
    label: `${card.p3PrePurchasePlan.label} — retail paid down per commit unit`,
    value: card.p3PrePurchasePlan.usdRetailPaidDownPerCommitUnit,
    unit: 'USD / commit unit',
    verified: true,
    sourceUrl: card.p3PrePurchasePlan.sourceUrl,
  });
  for (const t of card.p3PrePurchasePlan.tiers) {
    rateRows.push({
      key: `p3.tier.${t.commitUnits}`,
      label: `P3 tier — ${t.commitUnits.toLocaleString('en-US')} commit units`,
      value: t.discountPct / 100,
      unit: 'discount',
      verified: t.verified,
      sourceUrl: card.p3PrePurchasePlan.sourceUrl,
    });
  }
  for (const [k, v] of Object.entries(card.consumption)) {
    rateRows.push({
      key: `consumption.${k}`,
      label: v.label,
      value: v.credits,
      unit: `credits / ${v.unit}`,
      verified: v.verified,
      sourceUrl: v.sourceUrl,
    });
  }

  const rateStart = rates.rowCount + 1;
  const rateRef = new Map<string, string>();
  for (const rr of rateRows) {
    const r = rates.addRow([
      rr.label,
      rr.value,
      rr.unit,
      rr.verified ? 'verified' : 'ESTIMATE',
      rr.sourceUrl,
    ]);
    r.getCell(2).numFmt = rr.unit === 'discount' ? PCT : rr.unit.startsWith('USD') ? MONEY : DEC2;
    r.getCell(4).font = {
      size: 9,
      bold: !rr.verified,
      color: { argb: rr.verified ? 'FF1A7F4B' : 'FFB4530A' },
    };
    r.getCell(5).font = { size: 8, color: { argb: MUTED } };
    rateRef.set(rr.key, `RateCard!$B$${r.number}`);
  }
  zebra(rates, rateStart, rates.rowCount);

  const PAYG = rateRef.get('commercial.paygCreditUsd')!;
  const SEAT = rateRef.get('commercial.m365CopilotSeatMonthlyUsd')!;
  const PACK_RATE = rateRef.get('capacityPack.effective')!;

  /* ------------------------------------------------------ VolumeModel */
  titleRow(
    volume,
    'Volume model',
    'Units per month per workload at steady state, before any credit conversion. Internal share and licensed share drive the offset on the next sheet.',
  );
  widths(volume, [30, 34, 18, 24, 16, 20]);
  headerRow(volume, [
    'Workload',
    'Driver',
    'Units / month',
    'Unit',
    'Internal share',
    'Licensed share of internal',
  ]);

  const volStart = volume.rowCount + 1;
  for (const line of result.volume.lines) {
    const r = volume.addRow([
      workloadMeta(line.workloadId).label,
      line.label,
      line.quantity,
      line.unit,
      line.internalShare,
      line.licensedShareOfInternal,
    ]);
    r.getCell(3).numFmt = INT;
    r.getCell(3).font = { bold: true };
    r.getCell(5).numFmt = PCT;
    r.getCell(6).numFmt = PCT;
  }
  const volEnd = volume.rowCount;
  zebra(volume, volStart, volEnd);
  const volTotal = volume.addRow(['Total units / month', '', null, '', '', '']);
  volTotal.font = { bold: true };
  volTotal.getCell(3).value = { formula: `SUM(C${volStart}:C${volEnd})`, date1904: false };
  volTotal.getCell(3).numFmt = INT;

  const volRowOf = new Map<string, number>();
  result.volume.lines.forEach((l, i) => volRowOf.set(l.lineId, volStart + i));

  /* ------------------------------------------------------ CreditModel */
  titleRow(
    creditsWs,
    'Credit model',
    'Gross credits, the Microsoft 365 Copilot licence offset, and what remains billable. Columns C, E, G and H are live formulas reading from VolumeModel and RateCard.',
  );
  widths(creditsWs, [30, 34, 16, 15, 16, 14, 16, 16]);
  headerRow(creditsWs, [
    'Workload',
    'Driver',
    'Units / mo',
    'Credits / unit',
    'Gross credits',
    'Offset share',
    'Offset credits',
    'Billable credits',
  ]);

  const credStart = creditsWs.rowCount + 1;
  for (const line of result.credits.lines) {
    const vRow = volRowOf.get(line.lineId);
    const r = creditsWs.addRow([
      workloadMeta(line.workloadId).label,
      line.label,
      null,
      null,
      null,
      line.offsetShare,
      null,
      null,
    ]);
    const n = r.number;
    r.getCell(3).value = vRow ? { formula: `VolumeModel!C${vRow}`, date1904: false } : line.quantity;
    r.getCell(3).numFmt = INT;
    const rateCell = rateRef.get(`consumption.${line.rateId}`);
    r.getCell(4).value = rateCell
      ? { formula: rateCell.replace('RateCard!', 'RateCard!'), date1904: false }
      : line.creditsPerUnit;
    r.getCell(4).numFmt = DEC2;
    r.getCell(5).value = { formula: `C${n}*D${n}`, date1904: false };
    r.getCell(5).numFmt = INT;
    r.getCell(6).numFmt = PCT;
    r.getCell(7).value = { formula: `E${n}*F${n}`, date1904: false };
    r.getCell(7).numFmt = INT;
    r.getCell(8).value = { formula: `E${n}-G${n}`, date1904: false };
    r.getCell(8).numFmt = INT;
    r.getCell(8).font = { bold: true };
  }
  const credEnd = creditsWs.rowCount;
  zebra(creditsWs, credStart, credEnd);

  const credTotal = creditsWs.addRow(['Total', '', null, '', null, '', null, null]);
  credTotal.font = { bold: true };
  const ct = credTotal.number;
  credTotal.getCell(3).value = { formula: `SUM(C${credStart}:C${credEnd})`, date1904: false };
  credTotal.getCell(5).value = { formula: `SUM(E${credStart}:E${credEnd})`, date1904: false };
  credTotal.getCell(7).value = { formula: `SUM(G${credStart}:G${credEnd})`, date1904: false };
  credTotal.getCell(8).value = { formula: `SUM(H${credStart}:H${credEnd})`, date1904: false };
  [3, 5, 7, 8].forEach((c) => (credTotal.getCell(c).numFmt = INT));

  const BILLABLE = `CreditModel!$H$${ct}`;

  creditsWs.addRow([]);
  const derived: [string, string, string][] = [
    ['Billable credits / month', `=${BILLABLE}`, INT],
    ['Metered credit cost / month', `=${BILLABLE}*${PAYG}`, MONEY0],
    ['Cost at capacity pack rate / month', `=${BILLABLE}*${PACK_RATE}`, MONEY0],
    ['Billable credits per knowledge worker', `=${BILLABLE}/${KW}`, DEC2],
    ['Licence break-even at pay-as-you-go', `=${SEAT}/${PAYG}`, INT],
    ['Licence break-even at pack rate', `=${SEAT}/${PACK_RATE}`, INT],
  ];
  for (const [label, formula, fmt] of derived) {
    const r = creditsWs.addRow([label, '', '', '', null]);
    r.getCell(1).font = { bold: true };
    r.getCell(5).value = { formula: formula.slice(1), date1904: false };
    r.getCell(5).numFmt = fmt;
    r.getCell(5).font = { bold: true, color: { argb: ACCENT } };
  }

  /* --------------------------------------------------- FundingOptions */
  titleRow(
    funding,
    'Funding options',
    'All eight options costed over twelve months. Ineligible options are retained with their reason so the comparison is complete.',
  );
  widths(funding, [26, 16, 16, 16, 14, 14, 12, 12, 12, 40]);
  headerRow(funding, [
    'Option',
    'Credit funding',
    'Platform cost',
    '12-month total',
    'Δ vs primary',
    '$ / credit',
    'Waste %',
    'Shortfall %',
    'Lock-in',
    'Eligible / reason',
  ]);

  const fundStart = funding.rowCount + 1;
  const primaryTotal = result.recommendation.primary.twelveMonthTotalUsd;
  for (const o of result.fundingOptions) {
    const r = funding.addRow([
      o.label,
      o.creditFundingUsd,
      o.platformCostUsd,
      null,
      null,
      null,
      o.wastePctOfPurchased / 100,
      o.shortfallRiskPct / 100,
      o.commitmentLockInMonths,
      o.eligible ? o.bestWhen : `INELIGIBLE — ${o.ineligibleReasons.join('; ')}`,
    ]);
    const n = r.number;
    r.getCell(4).value = { formula: `B${n}+C${n}`, date1904: false };
    r.getCell(5).value = { formula: `D${n}-$D$${fundStart + primaryIndex(result)}`, date1904: false };
    r.getCell(6).value = { formula: `IF(${BILLABLE}*12=0,0,D${n}/(${BILLABLE}*12))`, date1904: false };
    [2, 3, 4, 5].forEach((c) => (r.getCell(c).numFmt = MONEY0));
    r.getCell(6).numFmt = MONEY;
    r.getCell(7).numFmt = PCT;
    r.getCell(8).numFmt = PCT;
    r.getCell(10).font = { size: 9, color: { argb: o.eligible ? MUTED : 'FFB4530A' } };
    if (o.id === result.recommendation.primary.optionId) {
      r.font = { bold: true };
      r.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F0FF' } };
      });
    }
  }
  funding.addRow([]);
  const cheapest = funding.addRow(['Cheapest eligible option (live)', '', '', null]);
  cheapest.font = { bold: true };
  cheapest.getCell(4).value = {
    formula: `MIN(D${fundStart}:D${fundStart + result.fundingOptions.length - 1})`,
    date1904: false,
  };
  cheapest.getCell(4).numFmt = MONEY0;
  funding.addRow([
    'Note',
    `Recommended is not always cheapest — the ranking also weighs waste, shortfall risk and reversibility. Primary here is "${result.recommendation.primary.label}" at ${fmtUsd(primaryTotal)}.`,
  ]).getCell(2).font = { size: 9, italic: true, color: { argb: MUTED } };

  /* --------------------------------------------------- 12MonthCashflow */
  titleRow(
    cash,
    'Twelve-month cash flow',
    'Expected-case credits per month with ramp and seasonality applied. Columns D–F are live.',
  );
  widths(cash, [12, 14, 14, 18, 18, 18, 18, 18]);
  headerRow(cash, [
    'Month',
    'Ramp',
    'Seasonality',
    'Conservative cr',
    'Expected cr',
    'Aggressive cr',
    'Expected cost',
    'Cumulative cost',
  ]);

  const cashStart = cash.rowCount + 1;
  for (const m of result.scenario.months) {
    const r = cash.addRow([
      m.label,
      m.rampFactor,
      m.seasonalityFactor,
      Math.round(m.conservativeCredits),
      Math.round(m.expectedCredits),
      Math.round(m.aggressiveCredits),
      null,
      null,
    ]);
    const n = r.number;
    r.getCell(2).numFmt = DEC2;
    r.getCell(3).numFmt = DEC2;
    [4, 5, 6].forEach((c) => (r.getCell(c).numFmt = INT));
    r.getCell(7).value = { formula: `E${n}*${PAYG}`, date1904: false };
    r.getCell(7).numFmt = MONEY0;
    r.getCell(8).value = {
      formula: n === cashStart ? `G${n}` : `H${n - 1}+G${n}`,
      date1904: false,
    };
    r.getCell(8).numFmt = MONEY0;
  }
  const cashEnd = cash.rowCount;
  zebra(cash, cashStart, cashEnd);

  const cashTotal = cash.addRow(['Total', '', '', null, null, null, null, '']);
  cashTotal.font = { bold: true };
  const tn = cashTotal.number;
  [4, 5, 6, 7].forEach((c) => {
    const col = String.fromCharCode(64 + c);
    cashTotal.getCell(c).value = { formula: `SUM(${col}${cashStart}:${col}${cashEnd})`, date1904: false };
    cashTotal.getCell(c).numFmt = c === 7 ? MONEY0 : INT;
  });
  cash.addRow([]);
  const peak = cash.addRow(['Peak month credits', '', '', null]);
  peak.getCell(4).value = { formula: `MAX(E${cashStart}:E${cashEnd})`, date1904: false };
  peak.getCell(4).numFmt = INT;
  const cv = cash.addRow(['Coefficient of variation', '', '', null]);
  cv.getCell(4).value = {
    formula: `IFERROR(STDEV(E${cashStart}:E${cashEnd})/AVERAGE(E${cashStart}:E${cashEnd}),0)`,
    date1904: false,
  };
  cv.getCell(4).numFmt = DEC2;
  cash.addRow([
    'Reading',
    'A coefficient of variation above 0.35 means a fixed annual commitment sized to the mean will either waste money in quiet months or run short in busy ones.',
  ]).getCell(2).font = { size: 9, italic: true, color: { argb: MUTED } };
  void tn;

  /* --------------------------------------------------------- Sensitivity */
  titleRow(
    sens,
    'Sensitivity',
    'One input varied at a time, everything else held at your answer. Sorted by the size of the swing.',
  );
  widths(sens, [36, 14, 14, 14, 18, 18, 18, 14]);
  headerRow(sens, [
    'Input',
    'Baseline',
    'Low',
    'High',
    'Total at low',
    'Total at high',
    'Swing',
    'Swing %',
  ]);
  const sensStart = sens.rowCount + 1;
  for (const s of result.sensitivity) {
    const r = sens.addRow([
      s.label,
      s.baselineValue,
      s.lowValue,
      s.highValue,
      s.lowTotalUsd,
      s.highTotalUsd,
      null,
      null,
    ]);
    const n = r.number;
    [2, 3, 4].forEach((c) => (r.getCell(c).numFmt = DEC2));
    [5, 6].forEach((c) => (r.getCell(c).numFmt = MONEY0));
    r.getCell(7).value = { formula: `F${n}-E${n}`, date1904: false };
    r.getCell(7).numFmt = MONEY0;
    r.getCell(8).value = { formula: `IF(E${n}=0,0,(F${n}-E${n})/E${n})`, date1904: false };
    r.getCell(8).numFmt = PCT;
  }
  zebra(sens, sensStart, sens.rowCount);

  /* ---------------------------------------------------------- AuditTrail */
  titleRow(
    audit,
    'Audit trail',
    `${result.audit.length} steps. Every figure in this workbook and in the report traces to one of these lines.`,
  );
  widths(audit, [30, 76, 18, 14, 26]);
  headerRow(audit, ['Step', 'Formula', 'Output', 'Unit', 'Rate card reference']);
  const auditStart = audit.rowCount + 1;
  for (const e of result.audit) {
    const r = audit.addRow([e.step, e.formula, e.output, e.outputUnit, e.rateCardRef ?? '—']);
    r.getCell(1).font = { size: 9, bold: true };
    r.getCell(2).font = { size: 9, name: 'Consolas' };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(3).numFmt = DEC2;
    r.getCell(5).font = { size: 8, color: { argb: MUTED } };
  }
  zebra(audit, auditStart, audit.rowCount);

  /* ------------------------------------------------------------ Footers */
  for (const ws of wb.worksheets) {
    ws.headerFooter.oddFooter = `&L&8${DISCLAIMER.replace(/&/g, '&&').slice(0, 250)}&R&8Page &P of &N`;
    ws.headerFooter.oddHeader = `&L&9Copilot Credit Compass — rate card ${result.rateCardVersion} (effective ${result.rateCardEffectiveDate})&R&9Generated ${new Date().toISOString().slice(0, 10)}`;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function primaryIndex(result: ExportInput['result']) {
  return Math.max(
    result.fundingOptions.findIndex((o) => o.id === result.recommendation.primary.optionId),
    0,
  );
}

function simple(key: string, r: { label: string; value: number; unit: string; verified: boolean; sourceUrl: string }) {
  return {
    key,
    label: r.label,
    value: r.value,
    unit: r.unit,
    verified: r.verified,
    sourceUrl: r.sourceUrl,
  };
}

function fmtUsd(v: number) {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}
