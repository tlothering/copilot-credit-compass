'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/ui';

export type TableSpec = {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
};

/**
 * Every chart in the dashboard is wrapped in this. The visual is decorative
 * (`aria-hidden`); the authoritative representation is the real <table>, which
 * is always in the accessibility tree and can be revealed visually too.
 */
export function ChartFrame({
  title,
  hint,
  table,
  right,
  className,
  children,
}: {
  title: string;
  hint?: string;
  table: TableSpec;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <section className={cn('card p-5', className)} aria-labelledby={`${id}-t`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 id={`${id}-t`} className="text-sm font-semibold tracking-tight">
            {title}
          </h3>
          {hint ? <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-tbl`}
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-line px-2 py-1 text-2xs text-fg-muted transition-colors hover:border-accent-line hover:text-fg"
          >
            {open ? 'Hide data' : 'Show data'}
          </button>
        </div>
      </div>

      <div aria-hidden="true">{children}</div>

      <div id={`${id}-tbl`} className={open ? 'mt-4 overflow-x-auto' : 'sr-only'}>
        <DataTable {...table} />
      </div>
    </section>
  );
}

export function DataTable({ caption, columns, rows }: TableSpec) {
  return (
    <table className="w-full border-collapse text-left text-xs">
      <caption className="mb-2 text-left text-2xs text-fg-subtle">{caption}</caption>
      <thead>
        <tr className="border-b border-line-strong">
          {columns.map((c, i) => (
            <th
              key={c}
              scope="col"
              className={cn(
                'py-1.5 pr-3 font-medium text-fg-muted',
                i > 0 && 'text-right tabular-nums',
              )}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-line/50 last:border-0">
            {r.map((cell, ci) => {
              const content = typeof cell === 'number' ? cell.toLocaleString() : cell;
              return ci === 0 ? (
                <th key={ci} scope="row" className="py-1.5 pr-3 font-normal">
                  {content}
                </th>
              ) : (
                <td key={ci} className="py-1.5 pr-3 text-right mono-num">
                  {content}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
