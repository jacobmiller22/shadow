#!/usr/bin/env bun
import { Command } from "commander";
import { TaskCommandHandler, type GlobalCliOptions } from "./commands/task";
import { DbCommandHandler } from "./commands/db";

const program = new Command();

program
  .name("shadow")
  .description("Shadow: Ultra-low latency, local-first issue engine & task tracking CLI")
  .version("2.0.0")
  .option("--json", "Output response in structured JSON for agents and pipelines")
  .option("--db-path <path>", "Explicit SQLite database path override")
  .option("--env <environment>", "Environment tier (production, development, test)");

function getGlobalOptions(): GlobalCliOptions {
  const opts = program.opts();
  return {
    json: Boolean(opts.json),
    dbPath: opts.dbPath,
    env: opts.env,
  };
}

// Top-level context command for fast agent prompt injection (SHD-SKILL-010)
program
  .command("context")
  .description("Display current workspace and active task execution context for agent injection")
  .action(() => {
    TaskCommandHandler.context(getGlobalOptions());
  });

// ==================== TASK COMMAND GROUP ====================
const taskCmd = program.command("task").description("Manage local tasks and work breakdown structures");

taskCmd
  .command("add <title>")
  .description("Create a new task")
  .option("-d, --desc <description>", "Inline task description")
  .option("-f, --body-file <path>", "Read description from file path or '-' for stdin")
  .option("-p, --priority <priority>", "Priority: critical, high, medium, low", "medium")
  .option("--parent <parentId>", "Parent task ID to nest under")
  .option("-s, --status <status>", "Initial status: todo, in_progress, blocked, done", "todo")
  .option("--id <customId>", "Explicit custom task ID (e.g. SHD-1001)")
  .option("--idempotency-key <key>", "Unique key to deduplicate agent task creation retries")
  .action(async (title, options) => {
    await TaskCommandHandler.add(title, options, getGlobalOptions());
  });

taskCmd
  .command("get <id>")
  .description("Retrieve task details by ID")
  .action((id) => {
    TaskCommandHandler.get(id, getGlobalOptions());
  });

taskCmd
  .command("active")
  .description("Show or auto-provision the currently active in-progress task")
  .option("--auto-create <title>", "Automatically create and activate a task if none active")
  .option("-p, --priority <priority>", "Priority for auto-created task", "high")
  .action((options) => {
    TaskCommandHandler.active(options, getGlobalOptions());
  });

taskCmd
  .command("pivot <newTaskId>")
  .description("Pause currently active task context and activate new target task")
  .action((newTaskId) => {
    TaskCommandHandler.pivot(newTaskId, getGlobalOptions());
  });

taskCmd
  .command("list")
  .description("List tasks in the current workspace")
  .option("-s, --status <status>", "Filter by status (todo, in_progress, blocked, done, cancelled)")
  .option("-p, --priority <priority>", "Filter by priority (critical, high, medium, low)")
  .option("--parent <parentId>", "Filter by parent task ID")
  .option("--all-workspaces", "List tasks across all git workspaces")
  .option("-l, --limit <count>", "Limit number of results")
  .action((options) => {
    TaskCommandHandler.list(options, getGlobalOptions());
  });

taskCmd
  .command("edit <id>")
  .description("Update an existing task")
  .option("-t, --title <title>", "New task title")
  .option("-d, --desc <description>", "New task description")
  .option("-f, --body-file <path>", "Read updated description from file or '-' for stdin")
  .option("-s, --status <status>", "New status (todo, in_progress, blocked, done, cancelled)")
  .option("-p, --priority <priority>", "New priority (critical, high, medium, low)")
  .option("--parent <parentId>", "Update parent task ID")
  .action(async (id, options) => {
    await TaskCommandHandler.edit(id, options, getGlobalOptions());
  });

taskCmd
  .command("close <id>")
  .description("Close a task and mark as done (runs checklist and verification checks)")
  .option("--force", "Bypass uncompleted checklist guard")
  .option("--verify-cmd <command>", "Verification command that must exit 0 before closure")
  .action((id, options) => {
    TaskCommandHandler.close(id, options, getGlobalOptions());
  });

taskCmd
  .command("checklist <id>")
  .description("Inspect or check off markdown checklist items on a task")
  .option("--check <indexOrText>", "Mark checklist item as completed")
  .option("--uncheck <indexOrText>", "Mark checklist item as incomplete")
  .action((id, options) => {
    TaskCommandHandler.checklist(id, options, getGlobalOptions());
  });

taskCmd
  .command("comment <id> <message>")
  .alias("log")
  .description("Append a progress note or audit log to the task")
  .action((id, message) => {
    TaskCommandHandler.comment(id, message, getGlobalOptions());
  });

taskCmd
  .command("history <id>")
  .alias("logs")
  .description("View chronological audit event history for a task")
  .action((id) => {
    TaskCommandHandler.history(id, getGlobalOptions());
  });

taskCmd
  .command("claim <id>")
  .description("Claim task with worker lock lease for subagent concurrency")
  .requiredOption("-w, --worker <workerId>", "Worker identifier claiming the task")
  .option("--lease <seconds>", "Lease duration in seconds (default: 300)", "300")
  .action((id, options) => {
    TaskCommandHandler.claim(id, options, getGlobalOptions());
  });

taskCmd
  .command("release <id>")
  .description("Release a worker claim lock")
  .requiredOption("-w, --worker <workerId>", "Worker identifier releasing the task")
  .action((id, options) => {
    TaskCommandHandler.release(id, options, getGlobalOptions());
  });

taskCmd
  .command("template")
  .description("List available task decomposition templates")
  .action(() => {
    TaskCommandHandler.templates(getGlobalOptions());
  });

taskCmd
  .command("decompose <id>")
  .description("Decompose a parent task into subtasks using a predefined template")
  .requiredOption("-t, --template <name>", "Template name (feature, bugfix, refactor, research)")
  .action((id, options) => {
    TaskCommandHandler.decompose(id, options, getGlobalOptions());
  });

taskCmd
  .command("delete <id>")
  .description("Permanently delete a task")
  .action((id) => {
    TaskCommandHandler.delete(id, getGlobalOptions());
  });

taskCmd
  .command("search <query>")
  .description("Full-text search tasks using SQLite FTS5")
  .option("-l, --limit <count>", "Limit number of results", "20")
  .action((query, options) => {
    TaskCommandHandler.search(query, options, getGlobalOptions());
  });

taskCmd
  .command("tree [id]")
  .description("Display hierarchical task tree")
  .action((id) => {
    TaskCommandHandler.tree(id, getGlobalOptions());
  });

// ==================== DATABASE COMMAND GROUP ====================
const dbCmd = program.command("db").description("Database administration, backups, and recovery");

dbCmd
  .command("backup")
  .description("Create an atomic online backup snapshot of the local database")
  .action(() => {
    DbCommandHandler.backup(getGlobalOptions());
  });

dbCmd
  .command("restore <snapshotPath>")
  .description("Restore database from a snapshot file")
  .action((snapshotPath) => {
    DbCommandHandler.restore(snapshotPath, getGlobalOptions());
  });

dbCmd
  .command("status")
  .description("Display database health, WAL size, and integrity status")
  .action(() => {
    DbCommandHandler.status(getGlobalOptions());
  });

program.parse(process.argv);
