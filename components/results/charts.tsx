'use client';

/**
 * Charts are hand-rolled SVG/CSS rather than a charting library wherever the
 * shape is simple. Reasons: exact control over the OKLCH token palette, no
 * layout thrash on container-query resize, and a much smaller bundle. Only the
 * 12-month projection — which needs stacked bands, a brush-free tooltip and
 * responsive ticks — uses Recharts.
 */

import { cn, compact, compactUsd, usd } from '@/lib/ui';

const SERIES = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
  'var(--color-series-6)',
  'var(--color-series-7)',
  'var(--color-series-8)',
];

export function seriesColor(i: number) {
  return SERIES[i % SERIES.length];
}

/* ------------------------------------------------------------- Waterfall */

export type WaterfallStep = {
  label: string;
  value: number;
  kind: 'start' | 'down' | 'up' | 'total';
  note?: string;
};

export function Waterfall({ steps, unit }: { steps: WaterfallStep[]; unit: 'credits' | 'usd' }) {
  const fmt = unit === 'usd' ? compactUsd : compact;
  let running = 0;
  const bars = steps.map((s) => {
    if (s.kind === 'start') {
      running = s.value;
      return { ...s, from: 0, to: s.value };
    }
    if (s.kind === 'total') return { ...s, from: 0, to: s.value };
    const from = running;
    running = s.kind === 'down' ? running - s.value : running + s.value;
    return { ...s, from: Math.min(from, running), to: Math.max(from, running) };
  });
  const max = Math.max(...bars.map((b) => b.to), 1);

  return (
    <div className="space-y-2">
      {bars.map((b) => {
        const left = (b.from / max) * 100;
        const width = Math.max(((b.to - b.from) / max) * 100, 0.6);
        const tone =
          b.kind === 'down'
            ? 'bg-success'
            : b.kind === 'total'
              ? 'bg-accent'
              : b.kind === 'start'
                ? 'bg-fg-subtle/60'
                : 'bg-warn';
        return (
          <div key={b.label} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-fg-muted" title={b.label}>
              {b.label}
            </span>
            <span className="relative block h-6 rounded-sm bg-bg-sunken">
              <span
                className={cn('absolute top-0 h-full rounded-sm transition-[width]', tone)}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </span>
            <span className="w-24 text-right text-xs font-medium mono-num">
              {b.kind === 'down' ? '−' : ''}
              {fmt(b.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Tornado */

export function Tornado({
  items,
}: {
  items: { label: string; low: number; high: number; baseline: number }[];
}) {
  const maxSwing = Math.max(...items.map((i) => Math.max(Math.abs(i.high - i.baseline), Math.abs(i.baseline - i.low))), 1);

  return (
    <div className="space-y-2">
      {items.map((it) => {
        const lowPct = ((it.baseline - it.low) / maxSwing) * 50;
        const highPct = ((it.high - it.baseline) / maxSwing) * 50;
        return (
          <div key={it.label} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-fg-muted" title={it.label}>
              {it.label}
            </span>
            <span className="relative block h-6 rounded-sm bg-bg-sunken">
              <span className="absolute left-1/2 top-0 h-full w-px bg-line-strong" />
              <span
                className="absolute top-0 h-full rounded-l-sm bg-success/70"
                style={{ right: '50%', width: `${Math.max(Math.abs(lowPct), 0)}%` }}
              />
              <span
                className="absolute top-0 h-full rounded-r-sm bg-warn/70"
                style={{ left: '50%', width: `${Math.max(Math.abs(highPct), 0)}%` }}
              />
            </span>
            <span className="w-32 text-right text-2xs mono-num text-fg-muted">
              {compactUsd(it.low)} – {compactUsd(it.high)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- Treemap */

type TreeNode = { label: string; value: number };

/** Squarified treemap (Bruls, Huizing & van Wijk) over a unit rectangle. */
function squarify(nodes: TreeNode[], w: number, h: number) {
  const total = nodes.reduce((s, n) => s + n.value, 0) || 1;
  const items = nodes.map((n) => ({ ...n, area: (n.value / total) * w * h }));
  const out: (TreeNode & { x: number; y: number; w: number; h: number })[] = [];
  let x = 0;
  let y = 0;
  let rw = w;
  let rh = h;
  let row: typeof items = [];

  const worst = (r: typeof items, side: number) => {
    const sum = r.reduce((s, i) => s + i.area, 0);
    if (sum === 0) return Infinity;
    const max = Math.max(...r.map((i) => i.area));
    const min = Math.min(...r.map((i) => i.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const flush = () => {
    const sum = row.reduce((s, i) => s + i.area, 0);
    const horizontal = rw >= rh;
    const thickness = horizontal ? sum / rh : sum / rw;
    let off = 0;
    for (const it of row) {
      const len = sum === 0 ? 0 : (it.area / sum) * (horizontal ? rh : rw);
      out.push(
        horizontal
          ? { ...it, x, y: y + off, w: thickness, h: len }
          : { ...it, x: x + off, y, w: len, h: thickness },
      );
      off += len;
    }
    if (horizontal) {
      x += thickness;
      rw -= thickness;
    } else {
      y += thickness;
      rh -= thickness;
    }
    row = [];
  };

  for (const it of items) {
    const side = Math.min(rw, rh);
    if (row.length === 0 || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else {
      flush();
      row.push(it);
    }
  }
  if (row.length) flush();
  return out;
}

export function Treemap({ nodes, unit }: { nodes: TreeNode[]; unit: 'credits' | 'usd' }) {
  const fmt = unit === 'usd' ? compactUsd : compact;
  const sorted = [...nodes].filter((n) => n.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, n) => s + n.value, 0) || 1;
  const cells = squarify(sorted, 100, 62);

  return (
    <div className="relative w-full" style={{ aspectRatio: '100 / 62' }}>
      {cells.map((c, i) => {
        const share = (c.value / total) * 100;
        const roomy = c.w > 16 && c.h > 11;
        return (
          <div
            key={c.label}
            className="absolute overflow-hidden rounded-sm border border-bg p-1.5"
            style={{
              left: `${c.x}%`,
              top: `${(c.y / 62) * 100}%`,
              width: `${c.w}%`,
              height: `${(c.h / 62) * 100}%`,
              // Tinted surface rather than a saturated fill. A saturated tile
              // cannot carry legible text in both themes — the light palette
              // sits at 66-80% lightness and the dark palette at 48-56%, so no
              // single label colour clears AA on both. Mixing the series hue
              // into the sunken surface keeps the tile unmistakably colour-coded
              // while letting the normal foreground token do the reading.
              background: `color-mix(in oklab, ${seriesColor(i)} 20%, var(--bg-sunken))`,
            }}
            title={`${c.label} — ${fmt(c.value)} (${share.toFixed(1)}%)`}
          >
            {roomy ? (
              <span className="block text-2xs leading-tight font-medium text-fg">
                {c.label}
                <span className="mono-num block font-normal text-fg">{fmt(c.value)}</span>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ Bullet bars */

export function BulletRow({
  label,
  value,
  max,
  highlight,
  note,
}: {
  label: string;
  value: number;
  max: number;
  highlight?: boolean;
  note?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3">
      <span className={cn('truncate text-xs', highlight ? 'font-semibold text-fg' : 'text-fg-muted')}>
        {label}
      </span>
      <span className="relative block h-5 rounded-sm bg-bg-sunken">
        <span
          className={cn('absolute left-0 top-0 h-full rounded-sm', highlight ? 'bg-accent' : 'bg-fg-subtle/45')}
          style={{ width: `${Math.max((value / (max || 1)) * 100, 0.6)}%` }}
        />
      </span>
      <span className="w-28 text-right text-xs mono-num">
        {usd(value)}
        {note ? <span className="ml-1 text-2xs text-fg-subtle">{note}</span> : null}
      </span>
    </div>
  );
}
