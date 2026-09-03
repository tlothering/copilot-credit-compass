'use client';

import { useState } from 'react';
import type { EngineResult } from '@/lib/engine/types';
import { Badge, Button } from '@/components/ui/primitives';
import { useSession } from '@/lib/store/session';

type Kind = 'pdf' | 'xlsx' | 'pptx';

const LABEL: Record<Kind, string> = {
  pdf: 'Board-ready PDF',
  xlsx: 'Excel model',
  pptx: 'Slide deck',
};

const HINT: Record<Kind, string> = {
  pdf: 'Eight pages, including the full audit trail.',
  xlsx: 'Live formulas, not pasted values — change an input and the model recalculates.',
  pptx: 'Six slides sized for a steering group.',
};

export function ExportBar({ result }: { result: EngineResult }) {
  const answers = useSession((s) => s.answers);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Kind) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/export/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `copilot-credit-compass-${result.rateCardVersion}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <div className="mr-auto">
        <p className="text-sm font-medium">Take this away</p>
        <p className="text-xs text-fg-subtle">
          Every export carries the rate card version, the effective date and the planning-estimate
          caveat.
        </p>
      </div>
      {(['pdf', 'xlsx', 'pptx'] as Kind[]).map((k) => (
        <Button
          key={k}
          variant="secondary"
          size="sm"
          onClick={() => run(k)}
          disabled={busy !== null}
          title={HINT[k]}
        >
          {busy === k ? 'Generating…' : LABEL[k]}
        </Button>
      ))}
      <Badge tone="neutral">{result.rateCardVersion}</Badge>
      {error ? (
        <p role="alert" className="w-full text-xs text-risk">
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {busy ? `Generating ${LABEL[busy]}` : ''}
      </p>
    </div>
  );
}
