import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const USD_PRECISE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function usd(value: number, precise = false): string {
  if (!Number.isFinite(value)) return '—';
  return precise ? USD_PRECISE.format(value) : USD.format(value);
}

export function num(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return NUM.format(Math.round(value));
}

export function pct(value: number, dp = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(dp)}%`;
}

/** Short form for axis labels and dense cards: 1.2M, 412k, 940. */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return NUM.format(Math.round(value));
}

export function compactUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `$${compact(value)}`;
}
