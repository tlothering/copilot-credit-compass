'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSession, skippedCount } from '@/lib/store/session';
import { WORKLOADS, workloadMeta } from '@/lib/schemas/taxonomy';
import { answersSchema } from '@/lib/schemas/answers';
import { Badge, Card } from '@/components/ui/primitives';
import { ToggleField } from '../fields';
import { USAGE_SPEC } from '../usage-spec';
import { buildBenchmarkRecord } from '@/lib/benchmark/record';
import { runEngine } from '@/lib/engine';

export function StepReview() {
  const answers = useSession((s) => s.answers);
  const touched = useSession((s) => s.touched);
  const consent = useSession((s) => s.answers.consent);
  const setConsent = useSession((s) => s.setConsent);
  const [showPayload, setShowPayload] = useState(false);

  const skipped = skippedCount({ answers, touched });
  const validation = useMemo(() => answersSchema.safeParse(answers), [answers]);

  const payload = useMemo(() => {
    if (!validation.success) return null;
    try {
      return buildBenchmarkRecord(answers, runEngine(answers));
    } catch {
      return null;
    }
  }, [answers, validation.success]);

  return (
    <div className="space-y-4">
      {!validation.success ? (
        <Card className="border-risk/50 bg-risk-quiet">
          <h2 className="text-sm font-medium">Some answers need attention</h2>
          <ul className="mt-2 space-y-1 text-xs text-fg-muted">
            {validation.error.issues.slice(0, 6).map((issue) => (
              <li key={issue.path.join('.')}>
                <span className="font-mono">{issue.path.join('.') || 'form'}</span> — {issue.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium">Your answers</h2>
          <Badge tone={skipped === 0 ? 'success' : skipped > 8 ? 'warn' : 'neutral'}>
            {skipped === 0
              ? 'Every question answered'
              : `${skipped} left at industry default`}
          </Badge>
        </div>
        <p className="mt-1.5 text-xs text-fg-subtle">
          Defaults are legitimate — they are just less certain. The confidence rating on your result
          reflects how many you used.
        </p>
      </Card>

      <SummaryCard title="Organisation" href="/assess/1">
        <Row label="Industry" value={answers.profile.industry} />
        <Row label="Region" value={answers.profile.region} />
        <Row label="Total employees" value={answers.profile.employeeBand} />
        <Row label="Knowledge workers" value={answers.profile.knowledgeWorkers.toLocaleString()} />
        <Row label="Azure agreement" value={answers.profile.azureAgreement} />
        {answers.profile.maccRemainingBand ? (
          <Row label="MACC remaining" value={`USD ${answers.profile.maccRemainingBand}`} />
        ) : null}
        <Row label="M365 base" value={answers.profile.m365Base} />
      </SummaryCard>

      <SummaryCard title={`Workloads (${answers.workloads.length})`} href="/assess/2">
        <div className="flex flex-wrap gap-1.5 py-1">
          {answers.workloads.length === 0 ? (
            <span className="text-sm text-fg-muted">None selected</span>
          ) : (
            answers.workloads.map((id) => (
              <Badge key={id} tone="accent">
                {workloadMeta(id).label}
              </Badge>
            ))
          )}
          {WORKLOADS.length - answers.workloads.length > 0 ? (
            <Badge tone="neutral">
              {WORKLOADS.length - answers.workloads.length} not selected
            </Badge>
          ) : null}
        </div>
      </SummaryCard>

      {answers.workloads.map((id) => {
        const block = answers.usage[id] as Record<string, unknown> | undefined;
        if (!block) return null;
        return (
          <SummaryCard key={id} title={workloadMeta(id).label} href="/assess/3">
            {USAGE_SPEC[id]
              .filter((f) => (f.showIf ? f.showIf(block) : true))
              .map((f) => (
                <Row
                  key={f.key}
                  label={f.label}
                  value={formatValue(block[f.key], f.kind, f.suffix)}
                  defaulted={!touched.includes(`usage.${id}.${f.key}`)}
                />
              ))}
          </SummaryCard>
        );
      })}

      <SummaryCard title="Growth & appetite" href="/assess/4">
        <Row
          label="Adoption ramp (m1 / m3 / m6 / m12)"
          value={`${answers.growth.rampMonth1Pct}% / ${answers.growth.rampMonth3Pct}% / ${answers.growth.rampMonth6Pct}% / ${answers.growth.rampMonth12Pct}%`}
        />
        <Row label="Confidence" value={answers.growth.confidence} />
        <Row label="Overage tolerance" value={answers.growth.budgetTolerance} />
        <Row label="Cost attribution per BU" value={yn(answers.growth.costAttributionPerBu)} />
        <Row label="Can commit annually" value={yn(answers.growth.canCommitAnnually)} />
        <Row
          label="Unspent Azure commitment"
          value={yn(answers.growth.hasUnspentAzureCommitment)}
        />
      </SummaryCard>

      {/* ------------------------------------------------------- Payload */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">
              The exact payload that would leave your browser
            </h2>
            <p className="mt-1 text-xs text-fg-subtle">
              Only sent if you opt in below. Nothing else is transmitted — no raw usage answers, no
              free text, no identifiers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPayload((v) => !v)}
            className="rounded-md border border-line px-3 py-1.5 text-xs transition-colors hover:border-accent-line"
            aria-expanded={showPayload}
          >
            {showPayload ? 'Hide' : 'Show'} JSON
          </button>
        </div>
        {showPayload ? (
          payload ? (
            <pre className="mt-4 max-h-96 overflow-auto rounded-field border border-line bg-bg-sunken p-4 font-mono text-2xs leading-relaxed">
              {JSON.stringify(payload, null, 2)}
            </pre>
          ) : (
            <p className="mt-4 text-xs text-fg-muted">
              The payload is generated once your answers validate and at least one workload is
              selected.
            </p>
          )
        ) : null}
      </Card>

      {/* ------------------------------------------------------- Consent */}
      <Card className="space-y-3">
        <h2 className="text-sm font-medium">Two things before we calculate</h2>
        <ToggleField
          id="contributeToBenchmark"
          checked={consent.contributeToBenchmark}
          onChange={(contributeToBenchmark) => setConsent({ contributeToBenchmark })}
          label="Contribute my anonymous results to the public benchmark"
          desc="Off by default. Sends only the payload above. You can still use the tool with this off, and your own results are identical either way."
        />
        <ToggleField
          id="understandsPlanningEstimate"
          checked={consent.understandsPlanningEstimate}
          onChange={(understandsPlanningEstimate) => setConsent({ understandsPlanningEstimate })}
          label="I understand this is a planning estimate, not a Microsoft quote"
          desc="Rates change, your agreement may include discounts, and Microsoft's own pricing is authoritative."
        />
        {!consent.understandsPlanningEstimate ? (
          <p role="status" className="text-xs text-warn">
            You can continue without acknowledging, but the caveat is printed on every export
            regardless.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function SummaryCard({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <Link
          href={href}
          className="text-xs text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-accent"
        >
          Edit
        </Link>
      </div>
      <dl className="divide-y divide-line/60 text-sm">{children}</dl>
    </Card>
  );
}

function Row({
  label,
  value,
  defaulted,
}: {
  label: string;
  value: string;
  defaulted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-fg-muted">
        {label}
        {defaulted ? <span className="ml-1.5 text-2xs text-warn">default</span> : null}
      </dt>
      <dd className="shrink-0 text-right font-medium mono-num">{value}</dd>
    </div>
  );
}

function yn(v: boolean) {
  return v ? 'Yes' : 'No';
}

function formatValue(v: unknown, kind: string, suffix?: string): string {
  if (typeof v === 'boolean') return yn(v);
  if (typeof v === 'number') {
    const n = v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (kind === 'percent') return `${n}%`;
    return suffix ? `${n} ${suffix}` : n;
  }
  if (typeof v === 'string') return v;
  return '—';
}
