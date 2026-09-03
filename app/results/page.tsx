import type { Metadata } from 'next';
import { Dashboard } from '@/components/results/dashboard';

export const metadata: Metadata = {
  title: 'Your assessment',
  description:
    'Credit consumption, twelve-month cost projection, funding option comparison and a recommended strategy with the full audit trail.',
};

export default function ResultsPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-[86rem] px-4 py-8 sm:px-6 lg:px-8">
      <Dashboard />
    </main>
  );
}
