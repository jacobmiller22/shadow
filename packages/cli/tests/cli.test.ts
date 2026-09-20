import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Milestone 0 CLI Tests", () => {
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
});
