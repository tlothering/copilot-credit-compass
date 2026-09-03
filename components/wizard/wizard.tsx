'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';
import { TOTAL_STEPS, useSession } from '@/lib/store/session';
import { useHydratedSession, useUnloadGuard } from '@/lib/store/guards';
import { RunningEstimate } from './running-estimate';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/ui';

import { StepWelcome } from './steps/step-welcome';
import { StepProfile } from './steps/step-profile';
import { StepWorkloads } from './steps/step-workloads';
import { StepUsage } from './steps/step-usage';
import { StepGrowth } from './steps/step-growth';
import { StepReview } from './steps/step-review';

export const STEP_META = [
  { title: 'Welcome', blurb: 'What this is, what it costs you, and what we keep.' },
  { title: 'Your organisation', blurb: 'Shape only. We never ask who you are.' },
  { title: 'Workloads', blurb: 'Pick everything you are considering, not just what is funded.' },
  { title: 'Usage', blurb: 'Business language. Skip anything you do not know.' },
  { title: 'Growth & appetite', blurb: 'How fast, how certain, how much risk you will carry.' },
  { title: 'Review & consent', blurb: 'See the exact payload before anything leaves the browser.' },
] as const;

/** Steps that must be answered before the next one is meaningful. */
function blockingReason(step: number, workloadCount: number): string | null {
  if (step === 2 && workloadCount === 0) return 'Select at least one workload to continue.';
  return null;
}

export function Wizard({ step }: { step: number }) {
  const router = useRouter();
  const hydrated = useHydratedSession();
  const workloads = useSession((s) => s.answers.workloads);
  const dirty = useSession((s) => s.dirty);
  const maxStep = useSession((s) => s.maxStep);
  const visitStep = useSession((s) => s.visitStep);

  useUnloadGuard(dirty);

  useEffect(() => {
    if (hydrated) visitStep(step);
  }, [hydrated, step, visitStep]);

  const blocked = blockingReason(step, workloads.length);

  const go = useCallback(
    (next: number) => {
      const href = next >= TOTAL_STEPS ? '/results' : `/assess/${next}`;
      const nav = () => router.push(href);
      // View Transitions give the panel swap continuity without a layout thrash.
      if (typeof document !== 'undefined' && 'startViewTransition' in document) {
        document.startViewTransition(nav);
      } else {
        nav();
      }
    },
    [router],
  );

  const meta = STEP_META[step] ?? STEP_META[0];

  const body = useMemo(() => {
    switch (step) {
      case 0:
        return <StepWelcome />;
      case 1:
        return <StepProfile />;
      case 2:
        return <StepWorkloads />;
      case 3:
        return <StepUsage />;
      case 4:
        return <StepGrowth />;
      default:
        return <StepReview />;
    }
  }, [step]);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-[86rem] px-4 py-12 sm:px-6" aria-busy="true">
        <div className="skeleton h-4 w-40 rounded" />
        <div className="skeleton mt-6 h-96 w-full rounded-card" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[86rem] px-4 py-8 sm:px-6 sm:py-12">
      <ProgressRail current={step} maxStep={maxStep} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <header className="mb-6">
            <p className="text-2xs font-medium tracking-widest text-accent uppercase">
              Step {step} of {TOTAL_STEPS - 1}
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">
              {meta.title}
            </h1>
            <p className="mt-1.5 text-fg-muted">{meta.blurb}</p>
          </header>

          <div style={{ viewTransitionName: 'wizard-panel' }}>{body}</div>

          <nav
            aria-label="Wizard navigation"
            className="mt-10 flex items-center justify-between gap-4 border-t border-line pt-6"
          >
            {step > 0 ? (
              <Button variant="secondary" onClick={() => go(step - 1)}>
                ← Back
              </Button>
            ) : (
              <Link
                href="/"
                className="inline-flex h-10 items-center rounded-field px-4 text-sm text-fg-muted hover:text-fg"
              >
                ← Leave
              </Link>
            )}

            <div className="flex items-center gap-3">
              {blocked ? (
                <p role="status" className="text-xs text-warn">
                  {blocked}
                </p>
              ) : null}
              <Button onClick={() => go(step + 1)} disabled={blocked !== null}>
                {step === TOTAL_STEPS - 1 ? 'Calculate my result →' : 'Continue →'}
              </Button>
            </div>
          </nav>
        </div>

        <RunningEstimate />
      </div>
    </div>
  );
}

function ProgressRail({ current, maxStep }: { current: number; maxStep: number }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
        {STEP_META.map((s, i) => {
          const state = i === current ? 'current' : i <= maxStep ? 'done' : 'todo';
          const content = (
            <span
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors',
                state === 'current' && 'border-accent bg-accent-quiet font-medium text-fg',
                state === 'done' && 'border-line text-fg-muted hover:border-accent-line hover:text-fg',
                state === 'todo' && 'border-line/60 text-fg-subtle',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-4 place-items-center rounded-full text-[10px] font-semibold',
                  state === 'current' ? 'bg-accent text-on-accent' : 'bg-ink-300 text-fg-subtle',
                )}
              >
                {i}
              </span>
              <span className="hidden sm:inline">{s.title}</span>
            </span>
          );
          return (
            <li key={s.title}>
              {state === 'todo' ? (
                <span aria-disabled="true">{content}</span>
              ) : (
                <Link
                  href={`/assess/${i}`}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className="rounded-full"
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
