import type { BenchmarkStore } from './types';
import { FileBenchmarkStore } from './file-store';
import { CosmosBenchmarkStore } from './cosmos-store';

let cached: BenchmarkStore | null = null;

/**
 * Chooses a store once per process.
 *
 * COSMOS_ENDPOINT set   -> Cosmos (Managed Identity, or the emulator's public
 *                          key when the endpoint is localhost).
 * COSMOS_ENDPOINT unset -> a file-backed store under .data/.
 *
 * There is no third state and no silent failover from Cosmos to the file
 * store: if Cosmos is configured but unreachable the request fails loudly,
 * because quietly writing benchmark rows to a container filesystem that is
 * about to be recycled would be worse than an error.
 *
 * `cosmos-store` has no top-level @azure/* import — the SDK is pulled in from
 * inside `connect()` — so importing the class here costs nothing in file mode.
 */
export function getStore(): BenchmarkStore {
  if (cached) return cached;
  const endpoint = process.env.COSMOS_ENDPOINT?.trim();
  cached = endpoint ? new CosmosBenchmarkStore(endpoint) : new FileBenchmarkStore();
  return cached;
}

/** Test seam. */
export function __setStore(store: BenchmarkStore | null): void {
  cached = store;
}

export type { BenchmarkStore };
