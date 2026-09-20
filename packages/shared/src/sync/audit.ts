import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { SQLiteConnectionFactory } from "../db/connection";
import type { SyncAuditLog } from "../db/schema";

export class SyncAuditLogger {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Records an immutable audit log entry.
   */
  public log(
    destination: string,
    action: string,
    payload: any,
    status: "success" | "failed"
  ): number {
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    const hash = createHash("sha256").update(payloadStr).digest("hex");
    const now = Date.now();
    let insertId = 0;

    SQLiteConnectionFactory.withRetry(() => {
      const res = this.db
        .query(
          `INSERT INTO sync_audit_log (destination, action, payload_hash, payload, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?);`
        )
        .run(destination, action, hash, payloadStr, status, now);

      insertId = Number(res.lastInsertRowid);
    });

    return insertId;
  }

  /**
   * Queries recent audit log entries.
   */
  public list(limit = 50): SyncAuditLog[] {
    const rows = this.db
      .query(
        `SELECT id, destination, action, payload_hash as payloadHash, payload, status, created_at as createdAt
         FROM sync_audit_log
         ORDER BY id DESC
         LIMIT ?;`
      )
      .all(limit) as any[];

    return rows;
  }
}
