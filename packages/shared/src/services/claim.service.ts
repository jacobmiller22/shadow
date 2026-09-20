import { Database } from "bun:sqlite";
import * as schema from "../db/schema";
import { SQLiteConnectionFactory } from "../db/connection";

export class LockCollisionError extends Error {
  public workerId: string;
  public remainingSeconds: number;

  constructor(taskId: string, workerId: string, remainingSeconds: number) {
    super(`Task ${taskId} is already claimed by worker '${workerId}' (${remainingSeconds}s remaining on lease)`);
    this.name = "LockCollisionError";
    this.workerId = workerId;
    this.remainingSeconds = remainingSeconds;
  }
}

export interface ClaimResult {
  taskId: string;
  workerId: string;
  claimedAt: number;
  leaseSeconds: number;
  expiresAt: number;
}

export class WorkerClaimService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Acquires or extends an exclusive worker claim lock on a task.
   * Throws LockCollisionError if task is currently held by a different worker within its lease.
   */
  public claimTask(taskId: string, workerId: string, leaseSeconds: number = 300): ClaimResult {
    const now = Date.now();
    const expiresAt = now + leaseSeconds * 1000;

    // Check existing active claim
    const existing = this.db
      .query(
        `SELECT * FROM worker_claims WHERE task_id = ? AND expires_at > ?;`
      )
      .get(taskId, now) as any;

    if (existing && existing.worker_id !== workerId) {
      const remainingSeconds = Math.max(0, Math.ceil((existing.expires_at - now) / 1000));
      throw new LockCollisionError(taskId, existing.worker_id, remainingSeconds);
    }

    SQLiteConnectionFactory.withRetry(() => {
      this.db
        .query(
          `INSERT INTO worker_claims (task_id, worker_id, claimed_at, lease_seconds, expires_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(task_id) DO UPDATE SET
             worker_id = excluded.worker_id,
             claimed_at = excluded.claimed_at,
             lease_seconds = excluded.lease_seconds,
             expires_at = excluded.expires_at;`
        )
        .run(taskId, workerId, now, leaseSeconds, expiresAt);

      // Record event in task_events
      this.db
        .query(
          `INSERT INTO task_events (task_id, event_type, payload, timestamp)
           VALUES (?, 'claimed', ?, ?);`
        )
        .run(taskId, JSON.stringify({ workerId, leaseSeconds, expiresAt }), now);
    });

    return {
      taskId,
      workerId,
      claimedAt: now,
      leaseSeconds,
      expiresAt,
    };
  }

  /**
   * Releases an existing claim lock held by a worker.
   */
  public releaseClaim(taskId: string, workerId: string): boolean {
    const res = this.db
      .query(`DELETE FROM worker_claims WHERE task_id = ? AND worker_id = ?;`)
      .run(taskId, workerId);

    if (res.changes > 0) {
      this.db
        .query(
          `INSERT INTO task_events (task_id, event_type, payload, timestamp)
           VALUES (?, 'released', ?, ?);`
        )
        .run(taskId, JSON.stringify({ workerId }), Date.now());
      return true;
    }
    return false;
  }

  /**
   * Retrieves active unexpired claim on a task.
   */
  public getClaim(taskId: string): ClaimResult | null {
    const now = Date.now();
    const row = this.db
      .query(`SELECT * FROM worker_claims WHERE task_id = ? AND expires_at > ?;`)
      .get(taskId, now) as any;

    if (!row) return null;

    return {
      taskId: row.task_id,
      workerId: row.worker_id,
      claimedAt: row.claimed_at,
      leaseSeconds: row.lease_seconds,
      expiresAt: row.expires_at,
    };
  }
}
