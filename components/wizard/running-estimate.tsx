'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/store/session';
import { compactUsd, num, usd } from '@/lib/ui';
import type { Answers } from '@/lib/schemas/answers';

interface Estimate {
  monthlyCredits: number;
  monthlyCostUsd: number;
  annualCostUsd: number;
  conservativeMonthlyCredits: number;
  aggressiveMonthlyCredits: number;
  rateCardVersion: string;
}

/** Debounced, cancellable call into the engine. Kept off the render path. */
function useLiveEstimate(answers: Answers, enabled: boolean) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [pending, setPending] = useState(false);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setEstimate(null);
      return;
    }
    const mine = ++generation.current;
    setPending(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        // Dynamic import keeps the engine out of the initial wizard bundle.
        const { runEstimate } = await import('@/lib/engine');
        if (generation.current !== mine) return;
        const started = performance.now();
        try {
          const next = runEstimate(answers);
          if (generation.current !== mine) return;
          setEstimate(next);
          setDurationMs(performance.now() - started);
        } catch {
          // Partial answers can be invalid mid-edit; keep the last good value.
        } finally {
          if (generation.current === mine) setPending(false);
        }
      })();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [answers, enabled]);

  return { estimate, pending, durationMs };
}

export function RunningEstimate() {
  const answers = useSession((s) => s.answers);
  const enabled = answers.workloads.length > 0;
  const { estimate, pending } = useLiveEstimate(answers, enabled);

  return (
    <aside
      aria-labelledby="running-estimate-heading"
      className="lg:sticky lg:top-20 lg:self-start"
    >
      <div className="card p-5">
        <h2 id="running-estimate-heading" className="text-sm font-semibold tracking-tight">
          Running estimate
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">
          Recalculated from the rate card as you answer. Steady-state month 12.
        </p>

        <div
          aria-live="polite"
          aria-atomic="true"
          aria-busy={pending}
          className="mt-4 space-y-4"
        >
          {!enabled ? (
            <p className="text-sm text-fg-muted">
              Pick at least one workload in step 2 and the estimate appears here.
            </p>
          ) : estimate == null ? (
            <div className="space-y-3" aria-hidden="true">
              <div className="skeleton h-9 w-32 rounded" />
              <div className="skeleton h-4 w-40 rounded" />
              <div className="skeleton h-4 w-28 rounded" />
            </div>
          ) : (
            <>
              <div>
                <p className="text-3xl font-semibold tracking-tight mono-num">
                  {compactUsd(estimate.annualCostUsd)}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  estimated 12-month credit spend at list
                </p>
              </div>

              <dl className="space-y-2 border-t border-line pt-3 text-sm">
                <Row label="Billable credits / month" value={num(estimate.monthlyCredits)} />
                <Row label="Credit cost / month" value={usd(estimate.monthlyCostUsd)} />
                <Row
                  label="Conservative — aggressive"
                  value={`${num(estimate.conservativeMonthlyCredits)} – ${num(
                    estimate.aggressiveMonthlyCredits,
                  )}`}
                />
              </dl>

              <p className="border-t border-line pt-3 font-mono text-2xs text-fg-subtle">
                rate card {estimate.rateCardVersion}
                {pending ? ' · recalculating' : ''}
              </p>
            </>
          )}
        </div>
      </div>

      <p className="mt-3 px-1 text-2xs text-fg-subtle">
        Planning estimate only. Excludes tax, discounts and any negotiated agreement terms.
      </p>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-medium mono-num">{value}</dd>
    </div>
  );
}
