import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Wizard, STEP_META } from '@/components/wizard/wizard';
import { TOTAL_STEPS } from '@/lib/store/session';

export function generateStaticParams() {
  return Array.from({ length: TOTAL_STEPS }, (_, i) => ({ step: String(i) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ step: string }>;
}): Promise<Metadata> {
  const { step } = await params;
  const meta = STEP_META[Number(step)];
  return { title: meta ? `${meta.title} · Assessment` : 'Assessment' };
}

export default async function AssessStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  const n = Number(step);
  if (!Number.isInteger(n) || n < 0 || n >= TOTAL_STEPS) notFound();
  return <Wizard step={n} />;
}
