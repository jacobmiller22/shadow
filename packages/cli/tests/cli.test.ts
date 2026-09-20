import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Milestone 0 & 1 CLI Tests", () => {
  let tempDir: string;
  let testDb: string;
  const cliPath = path.resolve(__dirname, "../src/index.ts");

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-cli-test-"));
    testDb = path.join(tempDir, "cli-test.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function runCli(args: string[]): string {
    const cmd = `bun run ${cliPath} --db-path ${testDb} ${args.join(" ")}`;
    return execSync(cmd, {
      encoding: "utf-8",
      env: { ...process.env, SHADOW_ENV: "test" },
    });
  }

  test("CLI task add and get", () => {
    const addOut = runCli(["task", "add", '"CLI Test Task"', "--desc", '"CLI Description"', "--priority", "high"]);
    expect(addOut.includes("Created task SHD-0001")).toBe(true);

    const getOut = runCli(["task", "get", "SHD-0001", "--json"]);
    const parsed = JSON.parse(getOut);
    expect(parsed.id).toBe("SHD-0001");
    expect(parsed.title).toBe("CLI Test Task");
    expect(parsed.priority).toBe("high");
  });

  test("CLI task list with JSON output", () => {
    runCli(["task", "add", '"Task One"']);
    runCli(["task", "add", '"Task Two"']);

    const listOut = runCli(["task", "list", "--json"]);
    const tasks = JSON.parse(listOut);
    expect(tasks.length).toBe(2);
    expect(tasks[0].title).toBe("Task One");
    expect(tasks[1].title).toBe("Task Two");
  });

  test("CLI task tree hierarchy", () => {
    runCli(["task", "add", '"Parent Task"']);
    runCli(["task", "add", '"Child Task"', "--parent", "SHD-0001"]);

    const treeOut = runCli(["task", "tree"]);
    expect(treeOut.includes("Parent Task")).toBe(true);
    expect(treeOut.includes("Child Task")).toBe(true);
  });

  test("CLI db status and backup", () => {
    runCli(["task", "add", '"Initial Task"']);

    const statusOut = runCli(["db", "status", "--json"]);
    const status = JSON.parse(statusOut);
    expect(status.exists).toBe(true);
    expect(status.integrity.ok).toBe(true);

    const backupOut = runCli(["db", "backup", "--json"]);
    const backup = JSON.parse(backupOut);
    expect(fs.existsSync(backup.filePath)).toBe(true);
  });

  test("SHD-SKILL-003: CLI idempotency key deduplication", () => {
    const out1 = runCli(["task", "add", '"Idempotent CLI Task"', "--idempotency-key", "turn-1"]);
    expect(out1.includes("Created task SHD-0001")).toBe(true);

    const out2 = runCli(["task", "add", '"Idempotent CLI Task"', "--idempotency-key", "turn-1"]);
    expect(out2.includes("deduplicated")).toBe(true);
  });

  test("SHD-SKILL-004 & SHD-SKILL-010: CLI active task and context output", () => {
    // Auto-create active task
    const activeOut = runCli(["task", "active", "--auto-create", '"Active Feature Work"']);
    expect(activeOut.includes("Auto-created active task SHD-0001")).toBe(true);

    // Top-level context command in JSON mode
    const contextOut = runCli(["context", "--json"]);
    const context = JSON.parse(contextOut);
    expect(context.workspace.id.length).toBe(16);
    expect(context.activeTask.id).toBe("SHD-0001");
    expect(context.activeTask.title).toBe("Active Feature Work");
  });

  test("SHD-SKILL-007: CLI checklist parsing and checking", () => {
    const checklistFile = path.join(tempDir, "checklist.md");
    fs.writeFileSync(checklistFile, "- [ ] Item A\n- [ ] Item B\n");
    runCli(["task", "add", '"Checklist Task"', "--body-file", checklistFile]);

    const checkOut = runCli(["task", "checklist", "SHD-0001", "--check", "0", "--json"]);
    const report = JSON.parse(checkOut);
    expect(report.total).toBe(2);
    expect(report.completed).toBe(1);
    expect(report.remaining).toBe(1);
  });

  test("SHD-SKILL-011: CLI task claim and release", () => {
    runCli(["task", "add", '"Claimable Task"']);

    const claimOut = runCli(["task", "claim", "SHD-0001", "--worker", "subagent-1", "--lease", "120", "--json"]);
    const claimParsed = JSON.parse(claimOut);
    expect(claimParsed.success).toBe(true);
    expect(claimParsed.claim.workerId).toBe("subagent-1");

    const releaseOut = runCli(["task", "release", "SHD-0001", "--worker", "subagent-1", "--json"]);
    expect(releaseOut.includes("Released claim")).toBe(true);
  });

  test("SHD-SKILL-013: CLI template listing and task decomposition", () => {
    const tmplOut = runCli(["task", "template", "--json"]);
    const templates = JSON.parse(tmplOut);
    expect(templates.length).toBeGreaterThanOrEqual(4);

    runCli(["task", "add", '"Parent Epic"']);
    const decompOut = runCli(["task", "decompose", "SHD-0001", "--template", "feature", "--json"]);
    const children = JSON.parse(decompOut);
    expect(children.length).toBe(4);
    expect(children[0].parentId).toBe("SHD-0001");
  });

  test("Milestone 3 CLI: link, sync, and audit commands", () => {
    runCli(["task", "add", '"Jira Linked Task"']);
    
    // Link command
    const linkOut = runCli(["link", "SHD-0001", "jira:ENG-101", "--json"]);
    const linkObj = JSON.parse(linkOut);
    expect(linkObj.success).toBe(true);
    expect(linkObj.link.remoteKey).toBe("ENG-101");

    // Task links list
    const linksOut = runCli(["task", "links", "SHD-0001", "--json"]);
    const linksArr = JSON.parse(linksOut);
    expect(linksArr.length).toBe(1);
    expect(linksArr[0].remoteKey).toBe("ENG-101");

    // Sync dry-run command
    const drySyncOut = runCli(["sync", "--dry-run", "--json"]);
    const dryObj = JSON.parse(drySyncOut);
    expect(dryObj.dryRun).toBe(true);

    // Sync execution command
    const syncOut = runCli(["sync", "--json"]);
    const syncObj = JSON.parse(syncOut);
    expect(syncObj.success).toBe(true);

    // Audit command
    const auditOut = runCli(["audit", "--json"]);
    const auditArr = JSON.parse(auditOut);
    expect(Array.isArray(auditArr)).toBe(true);

    // Unlink command
    const unlinkOut = runCli(["unlink", "SHD-0001", "jira:ENG-101", "--json"]);
    const unlinkObj = JSON.parse(unlinkOut);
    expect(unlinkObj.success).toBe(true);
  });
});
