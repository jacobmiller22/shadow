import { Database } from "bun:sqlite";
import { SQLiteConnectionFactory } from "../db/connection";

export interface RemoteLinkRecord {
  id: number;
  taskId: string;
  remoteSystem: string;
  remoteKey: string;
  remoteUrl: string | null;
  lastSyncedAt: number;
}

export class RemoteLinkService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Links a local task to a remote system entity (e.g. Jira issue or GitHub issue).
   */
  public linkTask(
    taskId: string,
    remoteSystem: "jira" | "github",
    remoteKey: string,
    remoteUrl?: string
  ): RemoteLinkRecord {
    const now = Date.now();

    SQLiteConnectionFactory.withRetry(() => {
      this.db
        .query(
          `INSERT INTO remote_links (task_id, remote_system, remote_key, remote_url, last_synced_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             remote_url = excluded.remote_url,
             last_synced_at = excluded.last_synced_at;`
        )
        .run(taskId, remoteSystem, remoteKey, remoteUrl || null, now);
    });

    const row = this.db
      .query(
        `SELECT * FROM remote_links
         WHERE task_id = ? AND remote_system = ? AND remote_key = ?
         ORDER BY id DESC LIMIT 1;`
      )
      .get(taskId, remoteSystem, remoteKey) as any;

    return {
      id: row.id,
      taskId: row.task_id,
      remoteSystem: row.remote_system,
      remoteKey: row.remote_key,
      remoteUrl: row.remote_url,
      lastSyncedAt: row.last_synced_at,
    };
  }

  /**
   * Retrieves all remote links for a specific task.
   */
  public getLinksForTask(taskId: string): RemoteLinkRecord[] {
    const rows = this.db
      .query(`SELECT * FROM remote_links WHERE task_id = ?;`)
      .all(taskId) as any[];

    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      remoteSystem: r.remote_system,
      remoteKey: r.remote_key,
      remoteUrl: r.remote_url,
      lastSyncedAt: r.last_synced_at,
    }));
  }

  /**
   * Retrieves all local tasks mapped to a remote key.
   */
  public getTasksForRemoteKey(remoteSystem: string, remoteKey: string): string[] {
    const rows = this.db
      .query(
        `SELECT task_id FROM remote_links
         WHERE remote_system = ? AND remote_key = ?;`
      )
      .all(remoteSystem, remoteKey) as any[];

    return rows.map((r) => r.task_id);
  }

  /**
   * Unlinks a remote mapping.
   */
  public unlinkTask(taskId: string, remoteSystem: string, remoteKey: string): boolean {
    const res = this.db
      .query(
        `DELETE FROM remote_links
         WHERE task_id = ? AND remote_system = ? AND remote_key = ?;`
      )
      .run(taskId, remoteSystem, remoteKey);

    return res.changes > 0;
  }
}
