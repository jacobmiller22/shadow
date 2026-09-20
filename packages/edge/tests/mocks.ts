import { Database } from "bun:sqlite";

/**
 * In-memory mock implementation of Cloudflare KVNamespace for unit testing.
 */
export class MockKVNamespace {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  public async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  public async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  public async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * In-memory mock implementation of Cloudflare D1Database using bun:sqlite.
 */
export class MockD1Database {
  private sqlite: Database;

  constructor(schemaSql: string) {
    this.sqlite = new Database(":memory:");
    this.sqlite.exec(schemaSql);
  }

  public prepare(query: string) {
    const sqlite = this.sqlite;
    let boundParams: any[] = [];

    return {
      bind(...params: any[]) {
        boundParams = params;
        return this;
      },
      async run() {
        const stmt = sqlite.query(query);
        const info = stmt.run(...boundParams);
        return { meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
      },
      async first<T = unknown>() {
        const stmt = sqlite.query(query);
        const row = stmt.get(...boundParams);
        return row as T | null;
      },
      async all<T = unknown>() {
        const stmt = sqlite.query(query);
        const results = stmt.all(...boundParams);
        return { results: results as T[] };
      },
    };
  }

  public close() {
    this.sqlite.close();
  }
}

/**
 * In-memory mock implementation of Cloudflare Queue producer.
 */
export class MockQueue {
  public messages: any[] = [];

  public async send(message: any): Promise<void> {
    this.messages.push(message);
  }
}
