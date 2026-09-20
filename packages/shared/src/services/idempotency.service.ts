import crypto from "node:crypto";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { SQLiteConnectionFactory } from "../db/connection";

export interface IdempotencyCheckResult {
  task: schema.Task | null;
  isDeduplicated: boolean;
  token: string;
}

export class IdempotencyEngine {
  private db: Database;
  private orm: ReturnType<typeof drizzle<typeof schema>>;

  constructor(db: Database) {
    this.db = db;
    this.orm = drizzle(db, { schema });
  }

  /**
   * Generates a deterministic token hash from workspace, parent, title, and 1-hour time bucket.
   */
  public static generateToken(
    workspaceId: string,
    title: string,
    parentId?: string | null,
    customKey?: string
  ): string {
    if (customKey && customKey.trim().length > 0) {
      return customKey.trim();
    }

    // 1-hour time bucket (3600000ms)
    const hourBucket = Math.floor(Date.now() / 3600000);
    const normalizedTitle = title.trim().toLowerCase();
    const parent = parentId || "root";

    const payload = `${workspaceId}:${parent}:${normalizedTitle}:${hourBucket}`;
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Checks if an idempotency token has already been recorded within its TTL.
   */
  public findExisting(token: string): schema.Task | null {
    this.pruneExpired();
    const now = Date.now();

    const row = this.db
      .query(
        `SELECT t.* FROM idempotency_tokens it
         JOIN tasks t ON t.id = it.task_id
         WHERE it.token = ? AND it.expires_at > ?
         LIMIT 1;`
      )
      .get(token, now) as any;

    if (!row) return null;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      parentId: row.parent_id,
      branch: row.branch,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  /**
   * Records an idempotency token linked to a newly created task.
   */
  public register(token: string, taskId: string, ttlSeconds: number = 3600): void {
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;

    SQLiteConnectionFactory.withRetry(() => {
      this.db
        .query(
          `INSERT OR REPLACE INTO idempotency_tokens (token, task_id, created_at, expires_at)
           VALUES (?, ?, ?, ?);`
        )
        .run(token, taskId, now, expiresAt);
    });
  }

  /**
   * Prunes expired idempotency tokens from the database.
   */
  public pruneExpired(): number {
    const now = Date.now();
    const res = this.db.query(`DELETE FROM idempotency_tokens WHERE expires_at <= ?;`).run(now);
    return res.changes;
  }
}
