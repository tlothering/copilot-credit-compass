'use client';

import { useEffect, useState } from 'react';
import { compactUsd, num } from '@/lib/ui';

interface TickerData {
  totalRuns: number;
  cohorts: number;
  medianCreditsPerUserPerMonth: number | null;
  medianAnnualUsd: number | null;
}

/**
 * Reads the public aggregate. Renders nothing but a quiet placeholder if the
 * benchmark has not yet reached the k-anonymity threshold or the API is down —
 * this block is decorative and must never block the landing page.
 */
export function BenchmarkTicker() {
  const [data, setData] = useState<TickerData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/benchmark/summary', { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<TickerData>) : Promise.reject(new Error('down'))))
      .then(setData)
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, []);

  if (failed) return null;

  const items = [
    { label: 'Assessments contributed', value: data ? num(data.totalRuns) : null },
    { label: 'Published cohorts', value: data ? num(data.cohorts) : null },
    {
      label: 'Median credits / user / month',
      value: data?.medianCreditsPerUserPerMonth != null ? num(data.medianCreditsPerUserPerMonth) : '—',
    },
    {
      label: 'Median 12-month credit spend',
      value: data?.medianAnnualUsd != null ? compactUsd(data.medianAnnualUsd) : '—',
    },
  ];

  return (
    <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="card p-5">
          <dt className="text-sm text-fg-muted">{item.label}</dt>
          <dd className="mt-2 text-2xl font-semibold tracking-tight mono-num">
            {item.value ?? <span className="skeleton block h-7 w-20 rounded" />}
          </dd>
        </div>
      ))}
    </dl>
  );
}
