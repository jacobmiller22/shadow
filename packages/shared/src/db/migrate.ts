import { Database } from "bun:sqlite";

export class MigrationsEngine {
  /**
   * Applies baseline SQLite schema DDL, indexes, FTS5 virtual tables, and synchronization triggers.
   */
  public static runMigrations(db: Database): void {
    db.exec(`
      -- Tasks core table
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        branch TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      -- Task indexes for fast queries
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_branch ON tasks(branch);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

      -- Task relations (blocks, relates_to, child_of)
      CREATE TABLE IF NOT EXISTS task_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_relations_source ON task_relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON task_relations(target_id);

      -- Task events (audit trail, session telemetry)
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);

      -- Sync queue for offline mutation persistence
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);

      -- Idempotency tokens table (SHD-SKILL-003)
      CREATE TABLE IF NOT EXISTS idempotency_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL UNIQUE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_idempotency_token ON idempotency_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_tokens(expires_at);

      -- Worker claim locks table (SHD-SKILL-011)
      CREATE TABLE IF NOT EXISTS worker_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
        worker_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        lease_seconds INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_claims_task ON worker_claims(task_id);
      CREATE INDEX IF NOT EXISTS idx_claims_expires ON worker_claims(expires_at);

      -- FTS5 Full-Text Search Virtual Table
      CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
        id UNINDEXED,
        title,
        description,
        tokenize='porter unicode61'
      );

      -- Synchronization triggers between tasks and tasks_fts
      CREATE TRIGGER IF NOT EXISTS trg_tasks_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO tasks_fts(id, title, description)
        VALUES (new.id, new.title, coalesce(new.description, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS trg_tasks_ad AFTER DELETE ON tasks BEGIN
        DELETE FROM tasks_fts WHERE id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_tasks_au AFTER UPDATE ON tasks BEGIN
        DELETE FROM tasks_fts WHERE id = old.id;
        INSERT INTO tasks_fts(id, title, description)
        VALUES (new.id, new.title, coalesce(new.description, ''));
      END;
    `);
  }
}
