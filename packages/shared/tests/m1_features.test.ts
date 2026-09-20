import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SQLiteConnectionFactory,
  MigrationsEngine,
  TaskService,
  ChecklistService,
  UncompletedChecklistError,
  VerificationFailedError,
  LockCollisionError,
} from "../src/index";

describe("Milestone 1 Agent Skill & Verification Tests", () => {
  let tempDir: string;
  let testDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-m1-test-"));
    testDbPath = path.join(tempDir, "test.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("SHD-SKILL-003: IdempotencyEngine prevents duplicate task creation on retries", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    // Initial creation
    const task1 = service.createTask({
      title: "Idempotent Task Creation",
      description: "Testing token deduplication",
      idempotencyKey: "agent-turn-12345",
    });
    expect(task1.isDeduplicated).toBe(false);

    // Simulated retry with same idempotencyKey
    const task2 = service.createTask({
      title: "Idempotent Task Creation",
      description: "Testing token deduplication",
      idempotencyKey: "agent-turn-12345",
    });
    expect(task2.isDeduplicated).toBe(true);
    expect(task2.id).toBe(task1.id);

    // Automatic token hashing when no custom key provided
    const task3 = service.createTask({
      title: "Auto Hash Task",
      workspaceId: "ws-test",
    });
    expect(task3.isDeduplicated).toBe(false);

    const task4 = service.createTask({
      title: "Auto Hash Task",
      workspaceId: "ws-test",
    });
    expect(task4.isDeduplicated).toBe(true);
    expect(task4.id).toBe(task3.id);

    db.close();
  });

  test("SHD-SKILL-004 & SHD-SKILL-005: Active task resolution and context pivot", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    const t1 = service.createTask({
      title: "Task 1",
      status: "in_progress",
      branch: "feature/auth",
      workspaceId: "ws-1",
    });
    const t2 = service.createTask({
      title: "Task 2",
      status: "todo",
      branch: "feature/auth",
      workspaceId: "ws-1",
    });

    const active = service.getActiveTask("feature/auth", "ws-1");
    expect(active).not.toBeNull();
    expect(active!.id).toBe(t1.id);

    // Pivot to Task 2
    const pivotResult = service.pivotTask(t2.id);
    expect(pivotResult.previous!.id).toBe(t1.id);
    expect(pivotResult.previous!.status).toBe("todo");
    expect(pivotResult.active.id).toBe(t2.id);
    expect(pivotResult.active.status).toBe("in_progress");

    db.close();
  });

  test("SHD-SKILL-006: Verification command gatekeeper protects task closure", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    const task = service.createTask({ title: "Verified Task" });

    // Fails when verifyCmd exits non-zero
    expect(() => {
      service.closeTask(task.id, { verifyCmd: "exit 1" });
    }).toThrow(VerificationFailedError);

    const stillOpen = service.getTask(task.id);
    expect(stillOpen!.status).not.toBe("done");

    // Succeeds when verifyCmd exits 0
    const closed = service.closeTask(task.id, { verifyCmd: "echo 'all tests pass'" });
    expect(closed.status).toBe("done");
    expect(closed.completedAt).not.toBeNull();

    db.close();
  });

  test("SHD-SKILL-007: ChecklistService blocks closure when unchecked items remain", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    const bodyWithChecklist = `
# Plan
- [x] Step 1: Interface
- [ ] Step 2: Implementation
- [ ] Step 3: Tests
    `;

    const task = service.createTask({
      title: "Checklist Task",
      description: bodyWithChecklist,
    });

    // Closure should throw UncompletedChecklistError
    expect(() => {
      service.closeTask(task.id);
    }).toThrow(UncompletedChecklistError);

    // Closure with --force bypasses checklist
    const closedForced = service.closeTask(task.id, { force: true });
    expect(closedForced.status).toBe("done");

    // Test ChecklistService.checkItem
    const updatedBody = ChecklistService.checkItem(bodyWithChecklist, 1, true);
    const report = ChecklistService.parse(updatedBody);
    expect(report.completed).toBe(2);
    expect(report.remaining).toBe(1);

    db.close();
  });

  test("SHD-SKILL-008: Progress comments and audit event history", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    const task = service.createTask({ title: "Audit Task" });
    service.addComment(task.id, "Investigating race condition in WAL checkpoint");
    service.addComment(task.id, "Applied mutex wrapper");

    const history = service.getTaskHistory(task.id);
    expect(history.length).toBe(3); // created + 2 comments
    const comments = history.filter((h) => h.eventType === "comment");
    expect(comments.length).toBe(2);

    db.close();
  });

  test("SHD-SKILL-011: Worker claim locks prevent collisions between parallel agents", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);
    const claims = service.getClaimsService();

    const task = service.createTask({ title: "Concurrent Subagent Task" });

    // Worker 1 claims task for 60 seconds
    const claim1 = claims.claimTask(task.id, "subagent-alpha", 60);
    expect(claim1.workerId).toBe("subagent-alpha");

    // Worker 2 attempts to claim same task -> LockCollisionError
    expect(() => {
      claims.claimTask(task.id, "subagent-beta", 60);
    }).toThrow(LockCollisionError);

    // Worker 1 releases claim
    const released = claims.releaseClaim(task.id, "subagent-alpha");
    expect(released).toBe(true);

    // Worker 2 can now claim task
    const claim2 = claims.claimTask(task.id, "subagent-beta", 60);
    expect(claim2.workerId).toBe("subagent-beta");

    db.close();
  });

  test("SHD-SKILL-013: Decomposition templates create structured subtasks", () => {
    const db = SQLiteConnectionFactory.open(testDbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);

    const parent = service.createTask({ title: "Build OAuth Relay" });
    const children = service.decomposeTask(parent.id, "feature");

    expect(children.length).toBe(4);
    expect(children[0].title.includes("Specification & Interface Design")).toBe(true);
    expect(children[1].title.includes("Core Implementation")).toBe(true);
    expect(children[0].parentId).toBe(parent.id);

    // Tree includes all children
    const tree = service.getTaskTree(parent.id);
    expect(tree[0].children.length).toBe(4);

    db.close();
  });
});
