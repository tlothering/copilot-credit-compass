import type { StoredRecord } from '@/lib/benchmark/record';

/**
 * The only surface the API routes are allowed to talk to. Two implementations
 * exist: Cosmos DB (production and the local emulator) and a file-backed
 * fallback so the app runs on a laptop with nothing installed.
 *
 * Deliberately narrow. There is no `get by id`, no `delete`, no `update` and
 * no query by anything user-specific, because none of those operations has a
 * legitimate use here and every one of them would be a way to re-identify a
 * submission.
 */
export interface BenchmarkStore {
  readonly kind: 'cosmos' | 'file';
  /** Persists one anonymous record. */
  insert(record: StoredRecord): Promise<void>;
  /** Returns every record. Cohorts are small; the whole set is aggregated in memory. */
  all(): Promise<StoredRecord[]>;
  /** Number of records currently stored. */
  count(): Promise<number>;
  /** True if the backing store answered. Used by the health surface only. */
  ping(): Promise<boolean>;
}
