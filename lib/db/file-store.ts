import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkStore } from './types';
import { storedRecordSchema, type StoredRecord } from '@/lib/benchmark/record';

/**
 * File-backed fallback so the whole application — including the benchmark —
 * runs with no Cosmos emulator and no Azure account. It is not intended for
 * production: writes are serialised behind a promise chain and the whole file
 * is rewritten each time, which is fine for a dev dataset and wrong for a real
 * one. `getStore()` will only ever hand this back when Cosmos is unconfigured.
 */
export class FileBenchmarkStore implements BenchmarkStore {
  readonly kind = 'file' as const;
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file = process.env.BENCHMARK_FILE ?? path.join(process.cwd(), '.data', 'benchmark.jsonl')) {
    this.file = file;
  }

  private serialise<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<StoredRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const out: StoredRecord[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = storedRecordSchema.safeParse(JSON.parse(trimmed));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // A malformed line is dropped rather than failing the whole read. The
        // benchmark is advisory; one bad row must not take the page down.
      }
    }
    return out;
  }

  async insert(record: StoredRecord): Promise<void> {
    await this.serialise(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const existing = await this.read();
      existing.push(record);
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, existing.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      await rename(tmp, this.file);
    });
  }

  async all(): Promise<StoredRecord[]> {
    return this.serialise(() => this.read());
  }

  async count(): Promise<number> {
    return (await this.all()).length;
  }

  async ping(): Promise<boolean> {
    try {
      await this.all();
      return true;
    } catch {
      return false;
    }
  }
}
