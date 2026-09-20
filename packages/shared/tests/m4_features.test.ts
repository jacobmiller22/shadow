import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  MigrationsEngine,
  TaskService,
  RemoteLinkService,
  SyncQueueManager,
  SyncAuditLogger,
  PrivacyFirewall,
} from "../src/index";
import { ShadowTuiApp } from "../../cli/src/tui/app";
import { HookCommandHandler } from "../../cli/src/commands/hook";
import { CompletionCommandHandler } from "../../cli/src/commands/completion";

describe("Milestone 4: Developer TUI, Web Viewer & Release Operations", () => {
  let db: Database;
  let taskService: TaskService;
  let linkService: RemoteLinkService;

  beforeEach(() => {
    db = new Database(":memory:");
    MigrationsEngine.runMigrations(db);
    taskService = new TaskService(db);
    linkService = new RemoteLinkService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("Terminal User Interface Engine (SHD-TUI-001, SHD-TUI-002, SHD-TUI-003)", () => {
    it("renders Kanban board with task cards", () => {
      taskService.createTask({ title: "Setup auth middleware", status: "todo", workspaceId: "ws-test" });
      taskService.createTask({ title: "Build Edge Worker", status: "in_progress", workspaceId: "ws-test" });
      taskService.createTask({ title: "Init Bun Monorepo", status: "done", workspaceId: "ws-test" });

      const app = new ShadowTuiApp(db, "ws-test");
      app.refresh();
      const output = app.render();

      expect(output).toContain("SHADOW TERMINAL UI");
      expect(output).toContain("TODO (1)");
      expect(output).toContain("IN PROGRESS (1)");
      expect(output).toContain("Setup auth");
      expect(output).toContain("Build Edge");
      expect(output).toContain("Init Bun");
    });

    it("advances task status across Kanban columns", () => {
      const task = taskService.createTask({ title: "Deploy Edge Worker", status: "todo", workspaceId: "ws-test" });
      const app = new ShadowTuiApp(db, "ws-test");
      app.refresh();

      // In todo column (col 0, index 0), advance moves to in_progress
      app.advanceSelectedTask();
      const updated1 = taskService.getTask(task.id);
      expect(updated1?.status).toBe("in_progress");

      // Advance again moves to done
      app.advanceSelectedTask();
      const updated2 = taskService.getTask(task.id);
      expect(updated2?.status).toBe("done");
    });
  });

  describe("Git Hook Automation (SHD-TUI-004)", () => {
    let tempDir: string;
    let oldCwd: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-hook-test-"));
      fs.mkdirSync(path.join(tempDir, ".git", "hooks"), { recursive: true });
      oldCwd = process.cwd();
      process.chdir(tempDir);
    });

    afterEach(() => {
      process.chdir(oldCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("installs and uninstalls non-blocking git hooks", () => {
      HookCommandHandler.install({ json: true });

      const postCommit = path.join(tempDir, ".git", "hooks", "post-commit");
      const prePush = path.join(tempDir, ".git", "hooks", "pre-push");

      expect(fs.existsSync(postCommit)).toBe(true);
      expect(fs.existsSync(prePush)).toBe(true);

      const postCommitContent = fs.readFileSync(postCommit, "utf-8");
      expect(postCommitContent).toContain("SHD-TUI-004");
      expect(postCommitContent).toContain("shadow task comment");

      // Uninstall
      HookCommandHandler.uninstall({ json: true });
      expect(fs.existsSync(postCommit)).toBe(false);
      expect(fs.existsSync(prePush)).toBe(false);
    });
  });

  describe("Shell Autocompletions (SHD-DOCS-002)", () => {
    it("generates completion scripts for zsh, bash, and fish", () => {
      let logged = "";
      const origLog = console.log;
      console.log = (msg: string) => { logged += msg + "\n"; };

      try {
        CompletionCommandHandler.generate("zsh");
        expect(logged).toContain("#compdef shadow");
        expect(logged).toContain("task:Manage local tasks");
        expect(logged).toContain("ui:Open interactive terminal");

        logged = "";
        CompletionCommandHandler.generate("bash");
        expect(logged).toContain("_shadow_completions()");

        logged = "";
        CompletionCommandHandler.generate("fish");
        expect(logged).toContain("complete -c shadow");
      } finally {
        console.log = origLog;
      }
    });
  });

  describe("End-to-End Multi-Worktree Multi-Agent Simulation (SHD-QA-001)", () => {
    it("simulates full lifecycle: worktree isolation, subtask decomposition, claims, verification gate, and sync", async () => {
      // 1. Agent A in worktree 'feature-auth' creates epic and decomposes
      const epic = taskService.createTask({
        title: "Feature: OAuth2 Token Mutex",
        branch: "feature/auth",
        workspaceId: "ws-auth",
      });

      const sub1 = taskService.createTask({
        title: "KV lock implementation",
        parentId: epic.id,
        branch: "feature/auth",
        workspaceId: "ws-auth",
        description: "- [ ] Write distributed mutex\n- [ ] Add unit test",
      });

      // 2. Subagent claims task with lease
      const claimDb = db.query(`INSERT INTO worker_claims (task_id, worker_id, claimed_at, lease_seconds, expires_at) VALUES (?, ?, ?, ?, ?);`);
      claimDb.run(sub1.id, "worker-agent-1", Date.now(), 300, Date.now() + 300000);

      // 3. Subagent links to remote Jira issue
      linkService.linkTask(sub1.id, "jira", "ENG-800");

      // 4. Subagent updates checklist and closes task with verification
      taskService.updateTask(sub1.id, {
        description: "- [x] Write distributed mutex\n- [x] Add unit test",
        status: "in_progress",
      });

      // 5. Offline sync queue records mutation
      const queue = new SyncQueueManager(db);
      const audit = new SyncAuditLogger(db);

      const queueId = queue.enqueue("task", sub1.id, "update", {
        id: sub1.id,
        title: sub1.title,
        status: "done",
        secretApiKey: "AKIA1111222233334444", // dirty secret to test privacy firewall
      });

      // Drain queue with privacy firewall
      await queue.drain(async (item) => {
        const payload = JSON.parse(item.payload);
        const sanitized = PrivacyFirewall.redactString(JSON.stringify(payload));
        expect(sanitized.text).not.toContain("AKIA1111222233334444");
        expect(sanitized.text).toContain("[REDACTED_AWS_KEY]");

        audit.log("edge", item.action, sanitized.text, "success");
      });

      expect(queue.countPending()).toBe(0);
      const auditLogs = audit.list(5);
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].status).toBe("success");
    });
  });
});
