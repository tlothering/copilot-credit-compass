import { describe, expect, it } from 'vitest';
import {
  addArrays,
  at,
  clamp,
  coefficientOfVariation,
  createAuditTrail,
  lerp,
  mean,
  normalCdf,
  percentile,
  round,
  roundCredits,
  roundUsd,
  safeDiv,
  scaleArray,
  stdDev,
  sum,
} from '@/lib/engine/util';

describe('sum / mean', () => {
  it.each([
    [[], 0, 0],
    [[5], 5, 5],
    [[1, 2, 3, 4], 10, 2.5],
    [[-2, 2], 0, 0],
  ] as const)('sum(%j) = %d, mean = %d', (values, expectedSum, expectedMean) => {
    expect(sum(values)).toBe(expectedSum);
    expect(mean(values)).toBe(expectedMean);
  });
});

describe('stdDev', () => {
  // Population sigma of [2,4,4,4,5,5,7,9] is exactly 2 — the textbook example.
  it('matches the textbook population standard deviation', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it.each([
    [[], 0],
    [[7], 0],
    [[3, 3, 3], 0],
  ] as const)('stdDev(%j) = %d', (values, expected) => {
    expect(stdDev(values)).toBe(expected);
  });
});

describe('coefficientOfVariation', () => {
  it('is sigma over mean', () => {
    // mean 5, population sigma 2 → 0.4
    expect(coefficientOfVariation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2 / 5, 12);
  });

  it('returns 0 rather than dividing by a zero mean', () => {
    expect(coefficientOfVariation([-1, 1])).toBe(0);
    expect(coefficientOfVariation([])).toBe(0);
  });
});

describe('percentile — Excel PERCENTILE.INC parity', () => {
  const data = [1, 2, 3, 4];
  it.each([
    [0, 1],
    [25, 1.75],
    [50, 2.5],
    [75, 3.25],
    [100, 4],
  ])('PERCENTILE.INC(%d%%) = %d', (p, expected) => {
    expect(percentile(data, p)).toBeCloseTo(expected, 10);
  });

  it('handles an unsorted input and a single value', () => {
    expect(percentile([4, 1, 3, 2], 50)).toBeCloseTo(2.5, 10);
    expect(percentile([9], 50)).toBe(9);
  });

  it('returns 0 for an empty set and clamps out-of-range percentiles', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile(data, -10)).toBe(1);
    expect(percentile(data, 900)).toBe(4);
  });
});

describe('clamp / safeDiv', () => {
  it.each([
    [5, 0, 10, 5],
    [-1, 0, 10, 0],
    [99, 0, 10, 10],
    [Number.NaN, 3, 10, 3],
  ])('clamp(%s, %d, %d) = %d', (v, lo, hi, expected) => {
    expect(clamp(v, lo, hi)).toBe(expected);
  });

  it.each([
    [10, 2, 5],
    [1, 0, 0],
    [1, Number.POSITIVE_INFINITY, 0],
    [Number.POSITIVE_INFINITY, 2, 0],
  ])('safeDiv(%s, %s) = %d', (a, b, expected) => {
    expect(safeDiv(a, b)).toBe(expected);
  });
});

describe('rounding', () => {
  it.each([
    [1.005, 2, 1.01],
    [2.675, 2, 2.68],
    [1.2345, 3, 1.235],
    [-0.0001, 2, 0],
  ])('round(%s, %d) = %s', (v, d, expected) => {
    expect(round(v, d)).toBe(expected);
  });

  it('never returns negative zero', () => {
    expect(Object.is(round(-0.0000001, 2), -0)).toBe(false);
  });

  it('returns 0 for non-finite input', () => {
    expect(round(Number.NaN)).toBe(0);
    expect(round(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('roundUsd is 2dp and roundCredits is 1dp', () => {
    expect(roundUsd(12.3456)).toBe(12.35);
    expect(roundCredits(12.3456)).toBe(12.3);
  });

  it('round defaults to two decimal places', () => {
    expect(round(3.14159)).toBe(3.14);
  });
});

describe('array helpers', () => {
  it('at falls back safely', () => {
    expect(at([1, 2, 3], 1)).toBe(2);
    expect(at([1, 2, 3], 9)).toBe(0);
    expect(at([1, 2, 3], 9, -1)).toBe(-1);
  });

  it('addArrays pads the shorter array with zeroes', () => {
    expect(addArrays([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33]);
    expect(addArrays([1], [10, 20])).toEqual([11, 20]);
    expect(addArrays([1, 2], [10])).toEqual([11, 2]);
  });

  it('scaleArray multiplies element-wise', () => {
    expect(scaleArray([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(scaleArray([], 5)).toEqual([]);
  });

  it.each([
    [0, 10, 0, 0],
    [0, 10, 1, 10],
    [0, 10, 0.25, 2.5],
    [10, 0, 0.5, 5],
  ])('lerp(%d, %d, %s) = %s', (a, b, t, expected) => {
    expect(lerp(a, b, t)).toBeCloseTo(expected, 12);
  });
});

describe('normalCdf', () => {
  // Reference values from standard normal tables.
  it.each([
    [0, 0.5],
    [1, 0.8413447],
    [-1, 0.1586553],
    [1.96, 0.9750021],
    [-1.96, 0.0249979],
    [2.5758293, 0.995],
    [3, 0.9986501],
    [-3, 0.0013499],
  ])('Phi(%s) ≈ %s', (z, expected) => {
    expect(normalCdf(z)).toBeCloseTo(expected, 6);
  });

  it('is symmetric about zero', () => {
    for (const z of [0.3, 0.9, 1.4, 2.2]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 9);
    }
  });

  it('saturates at the infinities', () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalCdf(Number.NaN)).toBe(0);
  });
});

describe('createAuditTrail', () => {
  it('records the full entry shape and returns the output value', () => {
    const trail = createAuditTrail();
    const returned = trail.record('step:one', 'a = b × c', { b: 2, c: 3 }, 6, 'credits', 'consumption.x');
    expect(returned).toBe(6);
    expect(trail.entries).toHaveLength(1);
    expect(trail.entries[0]).toEqual({
      step: 'step:one',
      formula: 'a = b × c',
      inputs: { b: 2, c: 3 },
      output: 6,
      outputUnit: 'credits',
      rateCardRef: 'consumption.x',
    });
  });

  it('defaults rateCardRef to null and preserves insertion order', () => {
    const trail = createAuditTrail();
    trail.record('one', 'f', {}, 1, 'u');
    trail.record('two', 'f', {}, 2, 'u');
    expect(trail.entries[0]?.rateCardRef).toBeNull();
    expect(trail.entries.map((e) => e.step)).toEqual(['one', 'two']);
  });
});
