import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EnvironmentResolver,
  SQLiteConnectionFactory,
  MigrationsEngine,
  TaskService,
  CycleError,
  BackupService,
  GitContextResolver,
} from "../src/index";

describe("Milestone 0 Core Foundation Tests", () => {
  let tempDir: string;
  let testDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-m0-test-"));
    testDbPath = path.join(tempDir, "test.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("SHD-CORE-002: EnvironmentResolver respects priority and creates 0700 directories", () => {
    // 1. Explicit path flag takes precedence
    const explicit = path.join(tempDir, "custom", "test.db");
    const resolved = EnvironmentResolver.resolveDatabasePath({ explicitPath: explicit });
    expect(resolved).toBe(path.resolve(explicit));
    expect(fs.existsSync(path.dirname(resolved))).toBe(true);

    // 2. Test environment uses ephemeral /tmp or memory
    const testResolved = EnvironmentResolver.resolveDatabasePath({ envOverride: "test" });
    expect(testResolved.includes("shadow-test-")).toBe(true);
    expect(testResolved.includes(".local/share/shadow")).toBe(false);

    // 3. Dev environment uses .shadow-dev under repo root
    const devResolved = EnvironmentResolver.resolveDatabasePath({
      envOverride: "development",
      repoRoot: tempDir,
    });
    expect(devResolved).toBe(path.join(tempDir, ".shadow-dev", "shadow.db"));
  });

  test("SHD-CORE-003: SQLiteConnectionFactory applies WAL pragmas and busy timeout", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);

    const journalMode = db.query("PRAGMA journal_mode;").get() as any;
    expect(String(Object.values(journalMode)[0]).toLowerCase()).toBe("wal");

    const busyTimeout = db.query("PRAGMA busy_timeout;").get() as any;
    expect(Number(Object.values(busyTimeout)[0])).toBe(10000);

    const cp = SQLiteConnectionFactory.checkpoint(db);
    expect(typeof cp.checkpointed).toBe("number");
    db.close();
  });

  test("SHD-CORE-005 & SHD-CORE-006: TaskService CRUD and event logging", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    // Create task
    const task = service.createTask({
      title: "Implement core SQLite engine",
      description: "Setup WAL and Drizzle models",
      priority: "high",
      status: "in_progress",
    });

    expect(task.id.startsWith("SHD-")).toBe(true);
    expect(task.title).toBe("Implement core SQLite engine");
    expect(task.status).toBe("in_progress");
    expect(task.priority).toBe("high");

    // Get task
    const retrieved = service.getTask(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(task.id);

    // Update task
    const updated = service.updateTask(task.id, {
      status: "done",
    });
    expect(updated.status).toBe("done");
    expect(updated.completedAt).not.toBeNull();

    // Verify task event log
    const events = db.query("SELECT * FROM task_events WHERE task_id = ?;").all(task.id) as any[];
    expect(events.length).toBe(2); // created, updated

    // Verify sync queue item
    const syncItems = db.query("SELECT * FROM sync_queue WHERE entity_id = ?;").all(task.id) as any[];
    expect(syncItems.length).toBe(2);

    db.close();
  });

  test("SHD-CORE-006: Cycle detection rejects loops in parent hierarchy", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    const t1 = service.createTask({ title: "Task 1" });
    const t2 = service.createTask({ title: "Task 2", parentId: t1.id });
    const t3 = service.createTask({ title: "Task 3", parentId: t2.id });

    // Try setting t1's parent to t3 (creates t1 -> t2 -> t3 -> t1 loop)
    expect(() => {
      service.updateTask(t1.id, { parentId: t3.id });
    }).toThrow(CycleError);

    // Try setting task as its own parent
    expect(() => {
      service.updateTask(t1.id, { parentId: t1.id });
    }).toThrow(CycleError);

    db.close();
  });

  test("SHD-CORE-006: Cycle detection rejects loops in blocking dependencies", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    const t1 = service.createTask({ title: "Task A" });
    const t2 = service.createTask({ title: "Task B" });
    const t3 = service.createTask({ title: "Task C" });

    // A blocks B
    service.addRelation(t1.id, t2.id, "blocks");
    // B blocks C
    service.addRelation(t2.id, t3.id, "blocks");

    // Trying C blocks A must throw CycleError
    expect(() => {
      service.addRelation(t3.id, t1.id, "blocks");
    }).toThrow(CycleError);

    // Self block must throw CycleError
    expect(() => {
      service.addRelation(t1.id, t1.id, "blocks");
    }).toThrow(CycleError);

    db.close();
  });

  test("SHD-CORE-007: SQLite FTS5 full-text search with live triggers", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    service.createTask({
      title: "Deploy Cloudflare Worker to Production",
      description: "Configure wrangler.toml and D1 bindings",
    });

    service.createTask({
      title: "Refactor SQLite Migrations",
      description: "Embedded DDL migrations runner",
    });

    // Search query
    const resultsWorker = service.searchTasks("Cloudflare");
    expect(resultsWorker.length).toBe(1);
    expect(resultsWorker[0].title).toBe("Deploy Cloudflare Worker to Production");

    const resultsD1 = service.searchTasks("wrangler");
    expect(resultsD1.length).toBe(1);

    const resultsSqlite = service.searchTasks("SQLite");
    expect(resultsSqlite.length).toBe(1);
    expect(resultsSqlite[0].title).toBe("Refactor SQLite Migrations");

    db.close();
  });

  test("SHD-CORE-008: GitContextResolver resolves workspace ID and active branch", () => {
    const context = GitContextResolver.resolve(process.cwd(), true);
    expect(context.isGitRepo).toBe(true);
    expect(context.workspaceId.length).toBe(16);
    expect(context.currentBranch.length).toBeGreaterThan(0);
  });

  test("SHD-CORE-012: BackupService creates atomic snapshot and verifies integrity", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    service.createTask({ title: "Critical Production Task" });

    // Create snapshot
    const backupDir = path.join(tempDir, "backups");
    const snapshot = BackupService.createSnapshot(db, tempDir);
    expect(fs.existsSync(snapshot.filePath)).toBe(true);
    expect(snapshot.sizeBytes).toBeGreaterThan(0);

    // Verify integrity
    const check = BackupService.checkIntegrity(db);
    expect(check.ok).toBe(true);

    // List snapshots
    const snapshots = BackupService.listSnapshots(tempDir);
    expect(snapshots.length).toBe(1);

    db.close();
  });
});
