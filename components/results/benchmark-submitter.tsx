'use client';

import { useEffect, useRef, useState } from 'react';
import type { EngineResult } from '@/lib/engine/types';
import { buildBenchmarkRecord } from '@/lib/benchmark/record';
import { useSession } from '@/lib/store/session';

type State = 'idle' | 'sending' | 'sent' | 'declined' | 'failed';

/**
 * Sends the anonymous record once, and only if the user opted in on the review
 * step. Failure is deliberately quiet: the benchmark is a courtesy, and a
 * user's own results must never depend on a POST succeeding.
 */
export function BenchmarkSubmitter({ result }: { result: EngineResult }) {
  const answers = useSession((s) => s.answers);
  const submittedAt = useSession((s) => s.submittedAt);
  const markSubmitted = useSession((s) => s.markSubmitted);
  const [state, setState] = useState<State>('idle');
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (!answers.consent.contributeToBenchmark) {
      setState('declined');
      return;
    }
    if (submittedAt) {
      setState('sent');
      return;
    }
    fired.current = true;
    setState('sending');

    const ac = new AbortController();
    (async () => {
      try {
        const record = buildBenchmarkRecord(answers, result);
        const res = await fetch('/api/benchmark/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        markSubmitted();
        setState('sent');
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') setState('failed');
      }
    })();

    return () => ac.abort();
  }, [answers, result, submittedAt, markSubmitted]);

  const message =
    state === 'sent'
      ? 'Your anonymised figures have been added to the public benchmark. Nothing that identifies you was sent.'
      : state === 'sending'
        ? 'Adding your anonymised figures to the benchmark…'
        : state === 'failed'
          ? 'The benchmark did not accept your contribution. Nothing else on this page is affected.'
          : 'You chose not to contribute to the benchmark, so nothing left your browser.';

  return (
    <p aria-live="polite" className="text-2xs text-fg-subtle">
      {message}
    </p>
  );
}
