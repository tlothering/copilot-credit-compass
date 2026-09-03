import type { AuditEntry, AuditValue } from './types';

/** Sum of a numeric array. Returns 0 for an empty array. */
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Arithmetic mean. Returns 0 for an empty array rather than NaN. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

/** Population standard deviation. Returns 0 for arrays shorter than 2. */
export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

/** Coefficient of variation (stdDev / mean). Returns 0 when the mean is 0. */
export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdDev(values) / m;
}

/**
 * Inclusive linear-interpolation percentile, matching Excel's PERCENTILE.INC so
 * the exported workbook reproduces the same number from the same data.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = clamp(p, 0, 100);
  const rank = (clamped / 100) * (sorted.length - 1);
  const lowIndex = Math.floor(rank);
  const highIndex = Math.ceil(rank);
  const low = sorted[lowIndex] ?? 0;
  const high = sorted[highIndex] ?? low;
  if (lowIndex === highIndex) return low;
  return low + (high - low) * (rank - lowIndex);
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Division that yields 0 instead of Infinity/NaN when the denominator is 0. */
export function safeDiv(numerator: number, denominator: number): number {
  if (denominator === 0 || !Number.isFinite(denominator)) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

/** Round to a fixed number of decimal places, avoiding negative-zero. */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const result = Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
  return result === 0 ? 0 : result;
}

/** Money is always rounded to whole cents. */
export function roundUsd(value: number): number {
  return round(value, 2);
}

/** Credits are fractional in the rate card but reported to one decimal place. */
export function roundCredits(value: number): number {
  return round(value, 1);
}

/** Safe array read under `noUncheckedIndexedAccess`. */
export function at(values: readonly number[], index: number, fallback = 0): number {
  return values[index] ?? fallback;
}

/** Element-wise sum of two equal-length arrays. */
export function addArrays(a: readonly number[], b: readonly number[]): number[] {
  const length = Math.max(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) out.push(at(a, i) + at(b, i));
  return out;
}

/** Multiply every element by a scalar. */
export function scaleArray(values: readonly number[], factor: number): number[] {
  return values.map((v) => v * factor);
}

/** Linear interpolation between two anchor points. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Standard normal cumulative distribution function, via the Abramowitz & Stegun 7.1.26
 * error-function approximation (absolute error < 1.5e-7). Deterministic and dependency-free.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Creates a collector for audit-trail entries. */
export function createAuditTrail() {
  const entries: AuditEntry[] = [];
  return {
    record(
      step: string,
      formula: string,
      inputs: Record<string, AuditValue>,
      output: number,
      outputUnit: string,
      rateCardRef: string | null = null,
    ): number {
      entries.push({ step, formula, inputs, output, outputUnit, rateCardRef });
      return output;
    },
    entries,
  };
}

export type AuditTrail = ReturnType<typeof createAuditTrail>;
