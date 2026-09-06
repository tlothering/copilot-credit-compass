'use client';

import { useEffect, useState } from 'react';
import { cn, num } from '@/lib/ui';
import { fundingOptionLabel } from '@/lib/benchmark/labels';
import type { BenchmarkSummary } from '@/lib/benchmark/aggregate';

/**
 * Reads the public aggregate. Renders nothing but a quiet placeholder if the
 * benchmark has not yet reached the k-anonymity threshold or the API is down —
 * this block is decorative and must never block the landing page.
 *
 * The shape is imported from the aggregator rather than restated locally. An
 * earlier local interface had drifted from the API and every tile silently
 * rendered an em dash, because `as Promise<T>` asserts a shape instead of
 * checking one and TypeScript had nothing to compare against.
 */
export function BenchmarkTicker() {
  const [data, setData] = useState<BenchmarkSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/benchmark/summary', { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<BenchmarkSummary>) : Promise.reject(new Error('down'))))
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) return null;

  const strategy = data?.headline.mostRecommendedStrategy;
  const items: { label: string; value: string | null; mono: boolean }[] = [
    {
      label: 'Assessments contributed',
      value: data ? num(data.headline.assessments) : null,
      mono: true,
    },
    {
      label: 'Published cohorts',
      value: data ? num(data.cohorts.length) : null,
      mono: true,
    },
    {
      label: 'Median credits / user / month',
      value: !data
        ? null
        : data.headline.medianCreditsPerKwPerMonth != null
          ? num(data.headline.medianCreditsPerKwPerMonth)
          : 'withheld',
      mono: true,
    },
    // There is no published median spend figure — deriving one from cohort
    // medians would be a median of medians, which the methodology explicitly
    // refuses to do. This shows something the aggregate actually reports.
    {
      label: 'Most recommended strategy',
      value: !data ? null : strategy ? fundingOptionLabel(strategy) : 'withheld',
      mono: false,
    },
  ];

  return (
    <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="card p-5">
          <dt className="text-sm text-fg-muted">{item.label}</dt>
          <dd
            className={cn(
              'mt-2 font-semibold tracking-tight text-balance',
              // Tabular numerals are for figures; a strategy name set in them
              // reads as a serial number and wraps badly.
              item.mono ? 'text-2xl mono-num' : 'text-lg',
            )}
          >
            {item.value ?? <span className="skeleton block h-7 w-20 rounded" />}
          </dd>
        </div>
      ))}
    </dl>
  );
}
