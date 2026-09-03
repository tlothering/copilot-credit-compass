'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/ui';

/* --------------------------------------------------------------- InfoPopover */

export function InfoPopover({ why, effect }: { why: string; effect: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="grid size-[18px] place-items-center rounded-full border border-line text-[10px] font-semibold text-fg-subtle transition-colors hover:border-accent-line hover:text-fg"
      >
        <span aria-hidden="true">i</span>
        <span className="sr-only">Why we ask this, and how it affects cost</span>
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        className="absolute top-6 left-0 z-40 w-72 rounded-card border border-line-strong bg-bg-raised p-3 text-xs leading-relaxed shadow-pop"
      >
        <strong className="block text-fg">Why we ask</strong>
        <span className="mt-0.5 block text-fg-muted">{why}</span>
        <strong className="mt-2 block text-fg">How it affects cost</strong>
        <span className="mt-0.5 block text-fg-muted">{effect}</span>
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- FieldShell */

interface FieldShellProps {
  label: string;
  htmlFor?: string;
  why?: string;
  effect?: string;
  hint?: string;
  error?: string;
  onSkip?: () => void;
  skipped?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FieldShell({
  label,
  htmlFor,
  why,
  effect,
  hint,
  error,
  onSkip,
  skipped,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {why && effect ? <InfoPopover why={why} effect={effect} /> : null}
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="ml-auto rounded-md px-2 py-0.5 text-2xs text-fg-subtle underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
          >
            Skip — use industry default
          </button>
        ) : null}
      </div>
      {children}
      {hint && !error ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
      {skipped && !error ? (
        <p className="text-xs text-warn">Using the documented industry default.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-risk">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- NumberField */

export function NumberField({
  id,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
  disabled,
  describedBy,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => {
          const next = e.currentTarget.valueAsNumber;
          onChange(Number.isNaN(next) ? 0 : next);
        }}
        className="h-10 w-40 rounded-field border border-line-strong bg-bg-raised px-3 text-sm mono-num transition-colors focus:border-accent"
      />
      {suffix ? <span className="text-sm text-fg-muted">{suffix}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------- PercentSlider */

export function PercentSlider({
  id,
  value,
  onChange,
  max = 100,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-ink-300 accent-accent"
      />
      <output htmlFor={id} className="w-14 text-right text-sm mono-num tabular-nums">
        {Math.round(value)}%
      </output>
    </div>
  );
}

/* ----------------------------------------------------------------- Selection */

export interface Option<T extends string> {
  value: T;
  label: string;
  desc?: string;
}

export function RadioCards<T extends string>({
  name,
  value,
  options,
  onChange,
  columns = 2,
}: {
  name: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3;
}) {
  const cols = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[columns];
  return (
    <div role="radiogroup" aria-label={name} className={cn('grid gap-2', cols)}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <label
            key={opt.value}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-field border p-3 text-sm transition-colors',
              selected
                ? 'border-accent bg-accent-quiet'
                : 'border-line bg-bg-raised hover:border-line-strong',
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block font-medium">{opt.label}</span>
              {opt.desc ? <span className="mt-0.5 block text-xs text-fg-muted">{opt.desc}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function SelectField<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value as T)}
      className="h-10 w-full max-w-sm rounded-field border border-line-strong bg-bg-raised px-3 text-sm transition-colors focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ToggleField({
  id,
  checked,
  onChange,
  label,
  desc,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-field border border-line bg-bg-raised p-3 transition-colors hover:border-line-strong"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="mt-0.5 size-4 accent-accent"
      />
      <span className="text-sm">
        <span className="block font-medium">{label}</span>
        {desc ? <span className="mt-0.5 block text-xs text-fg-muted">{desc}</span> : null}
      </span>
    </label>
  );
}

/** Turns a const-tuple of literals into select options with a label mapper. */
export function toOptions<T extends string>(
  values: readonly T[],
  label: (v: T) => string = (v) => v,
  desc?: (v: T) => string | undefined,
): Option<T>[] {
  return values.map((v) => ({ value: v, label: label(v), desc: desc?.(v) }));
}
