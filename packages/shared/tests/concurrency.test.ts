import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SQLiteConnectionFactory,
  MigrationsEngine,
  TaskService,
} from "../src/index";

describe("SHD-SKILL-009: High-Concurrency Multi-Worker Stress Test", () => {
  let tempDir: string;
  let testDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-concurrency-test-"));
    testDbPath = path.join(tempDir, "concurrency.db");
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    db.close();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("10 parallel subagents writing mutations simultaneously with zero SQLITE_BUSY crashes", async () => {
    const workerCount = 10;
    const tasksPerWorker = 5;

    const workerPromises = Array.from({ length: workerCount }, async (_, workerIdx) => {
      const db = SQLiteConnectionFactory.open(testDbPath);
      const service = new TaskService(db);
      const workerId = `worker-${workerIdx}`;

      for (let i = 0; i < tasksPerWorker; i++) {
        const task = service.createTask({
          title: `Concurrent Task from ${workerId} (#${i})`,
          workspaceId: "concurrency-ws",
          priority: "high",
        });

        // Claim task
        service.getClaimsService().claimTask(task.id, workerId, 60);

        // Add progress comments
        service.addComment(task.id, `Worker ${workerId} step 1`);
        service.addComment(task.id, `Worker ${workerId} step 2`);

        // Close task
        service.updateTask(task.id, { status: "done" });
      }

      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    });

    await Promise.all(workerPromises);

    // Verify all tasks and events persisted cleanly
    const verifyDb = SQLiteConnectionFactory.open(testDbPath);
    const countRow = verifyDb.query("SELECT count(*) as count FROM tasks;").get() as any;
    expect(countRow.count).toBe(workerCount * tasksPerWorker); // 50 tasks

    const doneCountRow = verifyDb.query("SELECT count(*) as count FROM tasks WHERE status = 'done';").get() as any;
    expect(doneCountRow.count).toBe(workerCount * tasksPerWorker);

    const eventCountRow = verifyDb.query("SELECT count(*) as count FROM task_events;").get() as any;
    // Each task: created (1) + claimed (1) + 2 comments (2) + updated to done (1) = 5 events per task
    expect(eventCountRow.count).toBe(workerCount * tasksPerWorker * 5); // 250 events

    verifyDb.close();
  });
});
