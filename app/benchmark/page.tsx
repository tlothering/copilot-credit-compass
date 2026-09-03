import type { Metadata } from 'next';
import { BenchmarkDashboard } from '@/components/benchmark/dashboard';

export const metadata: Metadata = {
  title: 'Benchmark',
  description:
    'Aggregated, k-anonymised Copilot credit consumption contributed by organisations that completed an assessment. Self-reported, self-selected and non-representative.',
};

export default function BenchmarkPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <p className="text-2xs uppercase tracking-[0.18em] text-fg-subtle">Public benchmark</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          What other organisations are projecting
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-fg-muted">
          Contributed voluntarily by people who completed an assessment and chose to share. Every
          figure is banded or rounded before it leaves the browser, and no cohort is published until
          at least five organisations sit inside it. There is no endpoint, export or query that
          returns an individual submission.
        </p>
      </header>
      <BenchmarkDashboard />
    </main>
  );
}
