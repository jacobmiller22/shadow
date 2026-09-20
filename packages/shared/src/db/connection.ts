import { Database } from "bun:sqlite";

export interface SQLiteRetryOptions {
  maxRetries?: number;
  minJitterMs?: number;
  maxJitterMs?: number;
}

export class SQLiteConnectionFactory {
  /**
   * Configures an open bun:sqlite Database instance with high-concurrency WAL pragmas.
   */
  public static configurePragmas(db: Database): void {
    // 1. Enable Write-Ahead Logging for non-blocking reads and concurrent writes
    db.exec("PRAGMA journal_mode = WAL;");
    // 2. Synchronous NORMAL is optimal for WAL mode durability and performance
    db.exec("PRAGMA synchronous = NORMAL;");
    // 3. Strict foreign key enforcement
    db.exec("PRAGMA foreign_keys = ON;");
    // 4. Wait up to 10,000ms on busy locks before raising SQLITE_BUSY
    db.exec("PRAGMA busy_timeout = 10000;");
    // 5. Autocheckpoint WAL every 1,000 pages (~4MB)
    db.exec("PRAGMA wal_autocheckpoint = 1000;");
  }

  /**
   * Opens or creates a SQLite database at the target path with WAL pragmas applied.
   */
  public static open(dbPath: string): Database {
    const db = new Database(dbPath, { create: true });
    this.configurePragmas(db);
    return db;
  }

  /**
   * Executes a passive WAL checkpoint to flush committed WAL frames to the main database.
   */
  public static checkpoint(db: Database): { busy: number; log: number; checkpointed: number } {
    try {
      const res = db.query("PRAGMA wal_checkpoint(PASSIVE);").get() as any;
      if (res && typeof res === "object") {
        const values = Object.values(res) as number[];
        return {
          busy: values[0] ?? 0,
          log: values[1] ?? 0,
          checkpointed: values[2] ?? 0
        };
      }
    } catch {
      // Gracefully handle checkpoint failures
    }
    return { busy: 0, log: 0, checkpointed: 0 };
  }

  /**
   * Executes a database operation with exponential backoff and randomized jitter to eliminate SQLITE_BUSY contention.
   */
  public static async withRetry<T>(
    operation: () => T | Promise<T>,
    options: SQLiteRetryOptions = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 5;
    const minJitter = options.minJitterMs ?? 10;
    const maxJitter = options.maxJitterMs ?? 250;

    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (err: any) {
        attempt++;
        const errorMessage = String(err?.message || "");
        const isBusy = errorMessage.includes("SQLITE_BUSY") || errorMessage.includes("database is locked");

        if (isBusy && attempt <= maxRetries) {
          // Exponential backoff with random jitter between minJitter and maxJitter * attempt
          const baseDelay = Math.min(minJitter * Math.pow(2, attempt - 1), maxJitter);
          const jitter = Math.floor(Math.random() * (baseDelay - minJitter + 1)) + minJitter;
          await new Promise((resolve) => setTimeout(resolve, jitter));
          continue;
        }
        throw err;
      }
    }
  }
}
