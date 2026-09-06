'use client';

import { useSession } from '@/lib/store/session';
import { WORKLOADS } from '@/lib/schemas/taxonomy';
import { creditCurrency, getRateCard } from '@/lib/engine/rate-card';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/ui';

const CARD = getRateCard();

export function StepWorkloads() {
  const selected = useSession((s) => s.answers.workloads);
  const toggle = useSession((s) => s.toggleWorkload);
  const setWorkloads = useSession((s) => s.setWorkloads);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-fg-muted">
          {selected.length === 0
            ? 'Nothing selected yet.'
            : `${selected.length} of ${WORKLOADS.length} selected.`}
        </p>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setWorkloads(WORKLOADS.map((w) => w.id))}
            className="rounded-md px-2 py-1 text-xs text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-accent"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setWorkloads([])}
            className="rounded-md px-2 py-1 text-xs text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-accent"
          >
            Clear
          </button>
        </div>
      </div>

      <fieldset>
        <legend className="sr-only">Copilot workloads you are considering</legend>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {WORKLOADS.map((w) => {
            const on = selected.includes(w.id);
            return (
              <li key={w.id}>
                <label
                  className={cn(
                    'flex h-full cursor-pointer flex-col gap-2 rounded-card border p-4 transition-[border-color,background-color,transform] duration-150',
                    on
                      ? 'border-accent bg-accent-quiet'
                      : 'border-line bg-bg-raised hover:border-line-strong',
                  )}
                >
                  <span className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(w.id)}
                      className="mt-0.5 size-4 shrink-0 accent-accent"
                    />
                    <span className="text-sm font-medium">{w.label}</span>
                  </span>
                  <span className="text-xs text-fg-muted">{w.blurb}</span>
                  <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {w.meteredInCredits ? (
                      <Badge tone="accent">
                        {creditCurrency(CARD, w.creditMeter ?? 'microsoft-copilot-credit').label}s
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Not credit-metered</Badge>
                    )}
                    {w.hasSeatCost ? <Badge tone="info">Has seat or provisioned cost</Badge> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <p className="text-xs text-fg-subtle">
        Select everything you are considering, not only what is already funded. Options you rule out
        later still inform the scenario band and the risk register.
      </p>
    </div>
  );
}
