'use client';

import { useSession } from '@/lib/store/session';
import { WORKLOAD_DEFAULTS } from '@/lib/schemas/answers';
import { workloadMeta, type WorkloadId } from '@/lib/schemas/taxonomy';
import { Badge, Card } from '@/components/ui/primitives';
import { FieldShell, NumberField, PercentSlider, SelectField, ToggleField } from '../fields';
import { USAGE_SPEC, type FieldSpec } from '../usage-spec';

type Block = Record<string, unknown>;

export function StepUsage() {
  const workloads = useSession((s) => s.answers.workloads);

  if (workloads.length === 0) {
    return (
      <Card>
        <p className="text-sm text-fg-muted">
          No workloads selected. Go back to step 2 and pick at least one.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-muted">
        Answer what you know. Anything you skip falls back to the documented industry default and is
        counted against your confidence rating — never silently guessed.
      </p>
      {workloads.map((id) => (
        <WorkloadBlock key={id} id={id} />
      ))}
    </div>
  );
}

function WorkloadBlock({ id }: { id: WorkloadId }) {
  const block = useSession((s) => s.answers.usage[id]) as Block | undefined;
  const setUsage = useSession((s) => s.setUsage);
  const resetUsage = useSession((s) => s.resetUsage);
  const touched = useSession((s) => s.touched);
  const meta = workloadMeta(id);
  const specs = USAGE_SPEC[id];
  const values: Block = block ?? (WORKLOAD_DEFAULTS[id] as Block);

  const visible = specs.filter((f) => (f.showIf ? f.showIf(values) : true));
  const sumGroups = new Map<string, number>();
  for (const f of visible) {
    if (!f.sumGroup) continue;
    const raw = values[f.key];
    sumGroups.set(f.sumGroup, (sumGroups.get(f.sumGroup) ?? 0) + (typeof raw === 'number' ? raw : 0));
  }

  const write = (key: string, value: unknown) =>
    setUsage(id, { [key]: value } as never);

  return (
    <section aria-labelledby={`wl-${id}`}>
      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <h2 id={`wl-${id}`} className="font-semibold tracking-tight">
              {meta.label}
            </h2>
            <p className="mt-1 text-xs text-fg-muted">{meta.blurb}</p>
          </div>
          <div className="flex items-center gap-2">
            {meta.meteredInCredits ? <Badge tone="accent">Credit-metered</Badge> : null}
            <button
              type="button"
              onClick={() => resetUsage(id)}
              className="rounded-md px-2 py-1 text-2xs text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-accent"
            >
              Reset all to defaults
            </button>
          </div>
        </div>

        {visible.map((f) => (
          <UsageField
            key={f.key}
            workload={id}
            spec={f}
            value={values[f.key]}
            skipped={!touched.includes(`usage.${id}.${f.key}`)}
            groupTotal={f.sumGroup ? sumGroups.get(f.sumGroup) : undefined}
            onChange={(v) => write(f.key, v)}
            onSkip={() => write(f.key, (WORKLOAD_DEFAULTS[id] as Block)[f.key])}
          />
        ))}
      </Card>
    </section>
  );
}

function UsageField({
  workload,
  spec,
  value,
  skipped,
  groupTotal,
  onChange,
  onSkip,
}: {
  workload: WorkloadId;
  spec: FieldSpec;
  value: unknown;
  skipped: boolean;
  groupTotal?: number;
  onChange: (v: unknown) => void;
  onSkip: () => void;
}) {
  const inputId = `${workload}-${spec.key}`;
  const mixError =
    groupTotal !== undefined && Math.abs(groupTotal - 100) > 0.51
      ? `These three must total 100%. Currently ${Math.round(groupTotal)}%.`
      : undefined;

  if (spec.kind === 'toggle') {
    return (
      <FieldShell label={spec.label} why={spec.why} effect={spec.effect}>
        <ToggleField
          id={inputId}
          checked={value === true}
          onChange={onChange}
          label={value === true ? 'Yes' : 'No'}
        />
      </FieldShell>
    );
  }

  return (
    <FieldShell
      label={spec.label}
      htmlFor={inputId}
      why={spec.why}
      effect={spec.effect}
      error={mixError}
      skipped={skipped}
      onSkip={onSkip}
    >
      {spec.kind === 'percent' ? (
        <PercentSlider
          id={inputId}
          value={typeof value === 'number' ? value : 0}
          onChange={onChange}
        />
      ) : spec.kind === 'select' ? (
        <SelectField
          id={inputId}
          value={typeof value === 'string' ? value : (spec.options?.[0]?.value ?? '')}
          options={spec.options ?? []}
          onChange={onChange}
        />
      ) : (
        <NumberField
          id={inputId}
          value={typeof value === 'number' ? value : 0}
          min={spec.min ?? 0}
          max={spec.max}
          step={spec.step ?? 1}
          suffix={spec.suffix}
          onChange={onChange}
        />
      )}
    </FieldShell>
  );
}
