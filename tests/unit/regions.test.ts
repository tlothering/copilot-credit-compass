import { describe, expect, it } from 'vitest';
import {
  LEGACY_REGION_ALIASES,
  REGIONS,
  REGION_GROUP,
  REGION_GROUPS,
  REGION_OPTIONS,
  normaliseRegion,
  regionSchema,
} from '@/lib/schemas/taxonomy';
import { benchmarkRecordSchema, storedRecordSchema } from '@/lib/benchmark/record';
import { profileSchema } from '@/lib/schemas/answers';

/**
 * Regions moved from Microsoft field/area names to the UN M49 standard.
 *
 * The migration matters more than the rename: both benchmark stores parse with
 * `safeParse` and silently drop whatever fails, so a record carrying a legacy
 * region would disappear from the benchmark without raising anything anywhere.
 */

/** The UN M49 sub-region level, in full. */
const M49_SUBREGIONS = [
  'Northern Africa',
  'Sub-Saharan Africa',
  'Latin America and the Caribbean',
  'Northern America',
  'Central Asia',
  'Eastern Asia',
  'South-eastern Asia',
  'Southern Asia',
  'Western Asia',
  'Eastern Europe',
  'Northern Europe',
  'Southern Europe',
  'Western Europe',
  'Australia and New Zealand',
  'Melanesia',
  'Micronesia',
  'Polynesia',
];

const RETIRED_INTERNAL_NAMES = [
  'NA',
  'LATAM',
  'UK&I',
  'Nordics',
  'CEE',
  'MEA',
  'India',
  'Japan',
  'ANZ',
  'ASEAN',
  'Greater China',
];

describe('region taxonomy', () => {
  it('is exactly the UN M49 sub-region set', () => {
    expect([...REGIONS]).toEqual(M49_SUBREGIONS);
  });

  it('contains no Microsoft-internal area names', () => {
    for (const internal of RETIRED_INTERNAL_NAMES) {
      expect(REGIONS as readonly string[]).not.toContain(internal);
    }
  });

  it('assigns every region to one of the five M49 top-level regions', () => {
    for (const r of REGIONS) {
      expect(REGION_GROUPS as readonly string[]).toContain(REGION_GROUP[r]);
    }
    // Every group is actually used; none is dead weight in the picker.
    expect(new Set(Object.values(REGION_GROUP)).size).toBe(REGION_GROUPS.length);
  });

  it('orders regions so each group is one contiguous run', () => {
    // SelectField builds <optgroup> from consecutive runs, so a group appearing
    // twice would silently render two headings with the same label.
    const seen: string[] = [];
    for (const r of REGIONS) {
      const g = REGION_GROUP[r];
      if (seen[seen.length - 1] !== g) seen.push(g);
    }
    expect(seen).toEqual([...new Set(seen)]);
  });

  it('exposes picker options that match the region list one for one', () => {
    expect(REGION_OPTIONS.map((o) => o.value)).toEqual([...REGIONS]);
    for (const o of REGION_OPTIONS) {
      expect(o.label).toBe(o.value);
      expect(o.group).toBe(REGION_GROUP[o.value]);
    }
  });
});

describe('normaliseRegion', () => {
  it('passes current regions through unchanged', () => {
    for (const r of REGIONS) expect(normaliseRegion(r)).toBe(r);
  });

  it('maps every retired internal name onto a current region', () => {
    for (const internal of RETIRED_INTERNAL_NAMES) {
      const mapped = normaliseRegion(internal);
      expect(mapped, `${internal} should migrate`).not.toBeNull();
      expect(REGIONS as readonly string[]).toContain(mapped!);
    }
  });

  it.each([
    ['NA', 'Northern America'],
    ['LATAM', 'Latin America and the Caribbean'],
    ['UK&I', 'Northern Europe'],
    ['Nordics', 'Northern Europe'],
    ['CEE', 'Eastern Europe'],
    ['India', 'Southern Asia'],
    ['Japan', 'Eastern Asia'],
    ['Greater China', 'Eastern Asia'],
    ['ANZ', 'Australia and New Zealand'],
    ['ASEAN', 'South-eastern Asia'],
  ])('maps %s to %s', (legacy, expected) => {
    expect(normaliseRegion(legacy)).toBe(expected);
  });

  it('resolves the ambiguous MEA area deterministically', () => {
    // MEA spanned Western Asia and both African sub-regions, so this mapping is
    // lossy by construction. It is asserted anyway: the value must be stable,
    // because an unstable one would silently reshuffle historical cohorts.
    expect(normaliseRegion('MEA')).toBe('Western Asia');
  });

  it('keeps "Western Europe" stable across the rename', () => {
    // The one label present in both taxonomies. It must not be aliased, or the
    // alias would shadow a perfectly valid current value.
    expect(normaliseRegion('Western Europe')).toBe('Western Europe');
    expect(LEGACY_REGION_ALIASES['Western Europe']).toBeUndefined();
  });

  it('never aliases a name that is already current', () => {
    for (const key of Object.keys(LEGACY_REGION_ALIASES)) {
      expect(REGIONS as readonly string[]).not.toContain(key);
    }
  });

  it('rejects values that are neither current nor legacy', () => {
    for (const v of ['', 'Atlantis', 'EMEA', 'APAC', 'northern europe']) {
      expect(normaliseRegion(v)).toBeNull();
    }
  });

  it('rejects non-string input rather than throwing', () => {
    for (const v of [null, undefined, 42, {}, ['Northern Europe']]) {
      expect(normaliseRegion(v)).toBeNull();
    }
  });
});

describe('regionSchema', () => {
  it('accepts current regions', () => {
    expect(regionSchema.parse('Southern Asia')).toBe('Southern Asia');
  });

  it('migrates a legacy value on parse', () => {
    expect(regionSchema.parse('UK&I')).toBe('Northern Europe');
  });

  it('rejects an unknown value instead of quietly substituting one', () => {
    expect(regionSchema.safeParse('APAC').success).toBe(false);
  });
});

describe('legacy records survive the rename', () => {
  const legacyRecord = {
    rateCardVersion: 'v1',
    industry: 'Financial Services',
    region: 'UK&I',
    employeeBand: '5k-25k',
    knowledgeWorkerBand: '1k-5k',
    workloads: ['copilot-studio-agents'],
    agentCount: 12,
    monthlyCreditsExpected: 1_045_000,
    monthlyCostExpectedUsd: 80_000,
    creditsPerKnowledgeWorkerPerMonth: 900,
    m365CopilotLicensedSharePct: 60,
    mixClassicPct: 40,
    mixGenerativePct: 40,
    mixActionPct: 20,
    graphGroundingPct: 30,
    recommendedStrategy: 'packs-plus-payg',
    estimatedAnnualSavingVsPaygUsd: 120_000,
  };

  it('parses a submission written under the old taxonomy', () => {
    const parsed = benchmarkRecordSchema.parse(legacyRecord);
    expect(parsed.region).toBe('Northern Europe');
  });

  it('parses a stored document written under the old taxonomy', () => {
    // This is the case that would otherwise vanish: both stores use safeParse
    // and push only on success, so a failure here is invisible data loss.
    const stored = {
      ...legacyRecord,
      region: 'ASEAN',
      id: '24109973-de69-4d58-901f-130a0c706b66',
      submittedAt: '2026-09-03T20:00:00.000Z',
      cohort: 'Financial Services|ASEAN|5k-25k',
    };
    const parsed = storedRecordSchema.safeParse(stored);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.region).toBe('South-eastern Asia');
  });

  it('migrates every retired name through the stored-record schema', () => {
    for (const internal of RETIRED_INTERNAL_NAMES) {
      const parsed = storedRecordSchema.safeParse({
        ...legacyRecord,
        region: internal,
        id: '24109973-de69-4d58-901f-130a0c706b66',
        submittedAt: '2026-09-03T20:00:00.000Z',
        cohort: `Financial Services|${internal}|5k-25k`,
      });
      expect(parsed.success, `${internal} record should survive`).toBe(true);
    }
  });

  it('migrates a half-finished session restored from sessionStorage', () => {
    const parsed = profileSchema.parse({
      industry: 'Other',
      region: 'Greater China',
      employeeBand: '1k-5k',
      knowledgeWorkers: 1000,
      azureAgreement: 'none',
      m365Base: 'E3',
    });
    expect(parsed.region).toBe('Eastern Asia');
  });
});
