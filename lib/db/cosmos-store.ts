import type { BenchmarkStore } from './types';
import { storedRecordSchema, type StoredRecord } from '@/lib/benchmark/record';

/**
 * Cosmos DB adapter.
 *
 * Authentication is Managed Identity in every deployed environment — there is
 * no connection string in app settings and no key in Key Vault, because the
 * data plane RBAC role assignment made in `infra/main.bicep` removes the need
 * for one. The only place a key is ever accepted is the local emulator, whose
 * key is a published constant and therefore not a secret.
 *
 * The container is partitioned on `/cohort`, which is the same coarse
 * industry|region|employeeBand tuple the benchmark publishes. That keeps a
 * cohort query to a single logical partition and, because the partition key
 * is deliberately low-cardinality, guarantees no partition can be traced to
 * an individual submitter.
 */

interface CosmosLike {
  database(id: string): {
    container(id: string): {
      items: {
        create(body: unknown): Promise<unknown>;
        query(q: { query: string; parameters?: { name: string; value: unknown }[] }): {
          fetchAll(): Promise<{ resources: unknown[] }>;
        };
      };
      read(): Promise<unknown>;
    };
  };
}

const DB = process.env.COSMOS_DATABASE ?? 'compass';
const CONTAINER = process.env.COSMOS_CONTAINER ?? 'benchmark';

/** The emulator's well-known key. Published by Microsoft; not a secret. */
const EMULATOR_KEY =
  'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';

export class CosmosBenchmarkStore implements BenchmarkStore {
  readonly kind = 'cosmos' as const;
  private client: CosmosLike | null = null;

  constructor(private readonly endpoint: string) {}

  private async connect(): Promise<CosmosLike> {
    if (this.client) return this.client;
    const { CosmosClient } = await import('@azure/cosmos');

    const isEmulator = /localhost|127\.0\.0\.1/i.test(this.endpoint);
    if (isEmulator) {
      // The emulator presents a self-signed certificate. Trusting it is scoped
      // to the emulator branch only so a production endpoint can never take
      // this path.
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      this.client = new CosmosClient({
        endpoint: this.endpoint,
        key: process.env.COSMOS_KEY ?? EMULATOR_KEY,
      }) as unknown as CosmosLike;
      return this.client;
    }

    const { DefaultAzureCredential } = await import('@azure/identity');
    this.client = new CosmosClient({
      endpoint: this.endpoint,
      aadCredentials: new DefaultAzureCredential(),
    }) as unknown as CosmosLike;
    return this.client;
  }

  private async container() {
    const client = await this.connect();
    return client.database(DB).container(CONTAINER);
  }

  async insert(record: StoredRecord): Promise<void> {
    const c = await this.container();
    await c.items.create(record);
  }

  async all(): Promise<StoredRecord[]> {
    const c = await this.container();
    const { resources } = await c.items
      .query({ query: 'SELECT * FROM c ORDER BY c.submittedAt DESC' })
      .fetchAll();
    const out: StoredRecord[] = [];
    for (const r of resources) {
      const parsed = storedRecordSchema.safeParse(r);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  async count(): Promise<number> {
    const c = await this.container();
    const { resources } = await c.items.query({ query: 'SELECT VALUE COUNT(1) FROM c' }).fetchAll();
    const first = resources[0];
    return typeof first === 'number' ? first : 0;
  }

  async ping(): Promise<boolean> {
    try {
      const c = await this.container();
      await c.read();
      return true;
    } catch {
      return false;
    }
  }
}
