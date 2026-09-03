/**
 * Shared export copy. The disclaimer text is verbatim from SPEC §12 and must
 * appear on every page of every export — it is imported, never re-typed.
 */

export const DISCLAIMER =
  'Copilot Credit Compass is an independent planning tool. It is not affiliated with, endorsed by, ' +
  'or a pricing quotation from Microsoft. Rates shown are from the rate card version stated and ' +
  'change without notice. Confirm all commercial terms — including capacity pack pricing, ' +
  'pre-purchase plan tiers, and Azure consumption commitment eligibility — with your Microsoft ' +
  'account team or partner before purchasing.';

export const SESSION_BANNER =
  'Nothing you enter is saved to a server. Your assessment lives only in this browser tab — ' +
  'closing or refreshing it will permanently discard your answers. Export your report before you leave.';

export const ROADMAP: { window: string; actions: string[] }[] = [
  {
    window: 'First 30 days',
    actions: [
      'Turn on pay-as-you-go billing policies in the Power Platform admin centre and bind them to the environments that will actually consume credits — not the whole tenant.',
      'Set environment-level credit allocation policies so a single runaway agent cannot drain the tenant pool.',
      'Configure capacity notifications and an Azure budget with alerts at 50%, 80% and 100% of the modelled expected case.',
      'Instrument consumption reporting: export the Power Platform admin centre consumption data weekly so month three is measured, not guessed.',
    ],
  },
  {
    window: 'Days 31–60',
    actions: [
      'Define the licence-shift cohort — the named users whose measured consumption clears the seat break-even — and validate the list against real telemetry rather than the modelled distribution.',
      'Separate internal from customer-facing traffic in reporting, because only internal traffic can ever be offset by a licence.',
      'Agree a chargeback or showback model per business unit if cost attribution was flagged as required.',
      'Put the negotiation questions to the Microsoft account team and record the answers against the assumptions in this model.',
    ],
  },
  {
    window: 'Days 61–90',
    actions: [
      'Run a true-up: compare measured credits per workload against the volume model and re-run this assessment with real numbers.',
      'Decide the commitment. Only commit once you have two consecutive months of measured data and the coefficient of variation is understood.',
      'Retire or consolidate any workload whose measured cost per outcome is worse than the manual process it replaced.',
      'Schedule the next review for the rate card effective date, because the rates in this model will change.',
    ],
  },
];

export const NEGOTIATION_QUESTIONS: string[] = [
  'Is Copilot credit consumption eligible to draw down against our Microsoft Azure Consumption Commitment, and is that eligibility contractual or discretionary?',
  'What are the pre-purchase plan tier prices in our local currency and billing entity, and do they change at renewal?',
  'How do existing discounts stack with capacity pack and pre-purchase pricing — are they applied before or after?',
  'Can we get a ramped commitment that starts below steady state and steps up, rather than a flat annual figure sized to month twelve?',
  'What happens to unused monthly capacity pack credits, and is any carry-over negotiable?',
  'If we shift users to M365 Copilot licences, is there a mid-term true-up mechanism or are we locked to the anniversary?',
  'What is the notice period and cancellation position on a pre-purchase plan if adoption stalls?',
  'Which of these rates are guaranteed for the term, and which are list prices subject to change?',
];
