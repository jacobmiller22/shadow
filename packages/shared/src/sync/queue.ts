import type { Database } from "bun:sqlite";
import { SQLiteConnectionFactory } from "../db/connection";
import type { SyncQueueItem } from "../db/schema";

export class SyncQueueManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Enqueues an entity mutation for outbound synchronization.
   */
  public enqueue(
    entityType: "task" | "relation",
    entityId: string,
    action: "create" | "update" | "delete",
    payload: Record<string, any>
  ): number {
    const now = Date.now();
    let insertId = 0;

    SQLiteConnectionFactory.withRetry(() => {
      const res = this.db
        .query(
          `INSERT INTO sync_queue (entity_type, entity_id, action, payload, created_at, status)
           VALUES (?, ?, ?, ?, ?, 'pending');`
        )
        .run(entityType, entityId, action, JSON.stringify(payload), now);

      insertId = Number(res.lastInsertRowid);
    });

    return insertId;
  }

  /**
   * Retrieves pending queue items ordered FIFO by creation time.
   */
  public getPending(limit = 100): SyncQueueItem[] {
    const rows = this.db
      .query(
        `SELECT id, entity_type as entityType, entity_id as entityId, action, payload, created_at as createdAt, status, error
         FROM sync_queue
         WHERE status = 'pending'
         ORDER BY id ASC
         LIMIT ?;`
      )
      .all(limit) as any[];

    return rows;
  }

  /**
   * Count how many items are pending sync.
   */
  public countPending(): number {
    const res = this.db
      .query(`SELECT count(*) as cnt FROM sync_queue WHERE status = 'pending';`)
      .get() as any;
    return res?.cnt || 0;
  }

  /**
   * Marks a queue item as successfully synchronized.
   */
  public markSynced(id: number): void {
    SQLiteConnectionFactory.withRetry(() => {
      this.db
        .query(`UPDATE sync_queue SET status = 'synced', error = NULL WHERE id = ?;`)
        .run(id);
    });
  }

  /**
   * Marks a queue item as failed with an error message.
   */
  public markFailed(id: number, error: string): void {
    SQLiteConnectionFactory.withRetry(() => {
      this.db
        .query(`UPDATE sync_queue SET status = 'failed', error = ? WHERE id = ?;`)
        .run(error, id);
    });
  }

  /**
   * Drains the queue in strict chronological FIFO order using a provided sync handler.
   */
  public async drain(
    handler: (item: SyncQueueItem) => Promise<void>
  ): Promise<{ processed: number; failed: number }> {
    const pending = this.getPending();
    let processed = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await handler(item);
        this.markSynced(item.id);
        processed++;
      } catch (err: any) {
        this.markFailed(item.id, err.message || String(err));
        failed++;
      }
    }

    return { processed, failed };
  }
}
