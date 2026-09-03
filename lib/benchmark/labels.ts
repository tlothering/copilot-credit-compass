/**
 * Human-readable names for funding option ids, used anywhere an id crosses a
 * wire and comes back as a bare string — the benchmark summary, the CSV and
 * the public dashboard. The engine's own labels live on the option objects;
 * this map exists because those objects are not available to a page that only
 * ever sees aggregates.
 */
const LABELS: Record<string, string> = {
  payg: 'Pay-as-you-go only',
  'packs-only': 'Capacity packs only',
  'packs-plus-payg': 'Packs + pay-as-you-go',
  'p3-plus-payg': 'P3 pre-purchase + pay-as-you-go',
  'p3-packs-payg': 'P3 + packs + pay-as-you-go',
  'licence-shift': 'Shift to M365 Copilot licences',
  'byom-foundry': 'Bring your own model (Foundry)',
  'do-nothing': 'Defer and re-baseline',
};

export function fundingOptionLabel(id: string): string {
  return LABELS[id] ?? id;
}
