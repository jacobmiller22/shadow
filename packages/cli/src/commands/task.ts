import { Database } from "bun:sqlite";
import {
  TaskService,
  SQLiteConnectionFactory,
  MigrationsEngine,
  EnvironmentResolver,
  GitContextResolver,
  ChecklistService,
  DecompositionTemplateService,
} from "@shadow/shared";
import { OutputFormatter, type FormatterOptions, ExitCodes } from "../formatters/output";
import { InputResolver } from "./input";

export interface GlobalCliOptions {
  json?: boolean;
  dbPath?: string;
  env?: string;
}

export class TaskCommandHandler {
  public static getService(globalOpts: GlobalCliOptions): { service: TaskService; db: Database } {
    const dbPath = EnvironmentResolver.resolveDatabasePath({
      explicitPath: globalOpts.dbPath,
      envOverride: globalOpts.env,
    });
    const db = SQLiteConnectionFactory.open(dbPath);
    MigrationsEngine.runMigrations(db);
    const service = new TaskService(db);
    return { service, db };
  }

  public static async add(
    title: string,
    options: {
      desc?: string;
      bodyFile?: string;
      priority?: string;
      parent?: string;
      status?: string;
      id?: string;
      idempotencyKey?: string;
    },
    globalOpts: GlobalCliOptions
  ): Promise<void> {
    const { service, db } = this.getService(globalOpts);
    try {
      const description = await InputResolver.resolveBody(options.desc, options.bodyFile);
      const task = service.createTask({
        title,
        description,
        priority: (options.priority as any) || "medium",
        parentId: options.parent,
        status: (options.status as any) || "todo",
        customId: options.id,
        idempotencyKey: options.idempotencyKey,
      });

      if (OutputFormatter.isJsonMode(globalOpts)) {
        OutputFormatter.printTask(task, globalOpts);
      } else {
        if (task.isDeduplicated) {
          OutputFormatter.printSuccess(`Returned existing task ${task.id} (deduplicated via idempotency key)`, globalOpts, task);
        } else {
          OutputFormatter.printSuccess(`Created task ${task.id}`, globalOpts, task);
        }
        OutputFormatter.printTask(task, globalOpts);
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static get(id: string, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const task = service.getTask(id);
      if (!task) {
        OutputFormatter.printError(`Task not found: ${id}`, globalOpts);
        return;
      }
      OutputFormatter.printTask(task, globalOpts);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      db.close();
    }
  }

  public static active(
    options: { autoCreate?: string; priority?: string },
    globalOpts: GlobalCliOptions
  ): void {
    const { service, db } = this.getService(globalOpts);
    try {
      let task = service.getActiveTask();
      if (!task && options.autoCreate) {
        task = service.createTask({
          title: options.autoCreate,
          status: "in_progress",
          priority: (options.priority as any) || "medium",
        });
        if (!OutputFormatter.isJsonMode(globalOpts)) {
          OutputFormatter.printSuccess(`Auto-created active task ${task.id}`, globalOpts, task);
        }
      }

      if (!task) {
        if (OutputFormatter.isJsonMode(globalOpts)) {
          console.log(JSON.stringify({ active: null, message: "No active in-progress task found" }));
        } else {
          console.log("No active in-progress task. Use 'shadow task add' or 'shadow task active --auto-create <title>' to start work.");
        }
        return;
      }

      OutputFormatter.printTask(task, globalOpts);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      db.close();
    }
  }

  public static pivot(newTaskId: string, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const result = service.pivotTask(newTaskId);
      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.previous) {
          OutputFormatter.printSuccess(`Paused previous task ${result.previous.id}`);
        }
        OutputFormatter.printSuccess(`Active context pivoted to ${result.active.id}: ${result.active.title}`);
        OutputFormatter.printTask(result.active, globalOpts);
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static list(
    options: {
      status?: string;
      priority?: string;
      parent?: string;
      allWorkspaces?: boolean;
      limit?: string;
    },
    globalOpts: GlobalCliOptions
  ): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const tasks = service.listTasks({
        status: options.status,
        priority: options.priority,
        parentId: options.parent,
        allWorkspaces: options.allWorkspaces,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
      OutputFormatter.printTaskList(tasks, globalOpts);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      db.close();
    }
  }

  public static async edit(
    id: string,
    options: {
      title?: string;
      desc?: string;
      bodyFile?: string;
      status?: string;
      priority?: string;
      parent?: string;
    },
    globalOpts: GlobalCliOptions
  ): Promise<void> {
    const { service, db } = this.getService(globalOpts);
    try {
      const description = await InputResolver.resolveBody(options.desc, options.bodyFile);
      const task = service.updateTask(id, {
        title: options.title,
        description,
        status: options.status as any,
        priority: options.priority as any,
        parentId: options.parent,
      });
      OutputFormatter.printSuccess(`Updated task ${id}`, globalOpts, task);
      OutputFormatter.printTask(task, globalOpts);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static close(
    id: string,
    options: { force?: boolean; verifyCmd?: string },
    globalOpts: GlobalCliOptions
  ): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const task = service.closeTask(id, {
        force: options.force,
        verifyCmd: options.verifyCmd,
      });
      OutputFormatter.printSuccess(`Closed task ${id}`, globalOpts, task);
      OutputFormatter.printTask(task, globalOpts);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static checklist(
    id: string,
    options: { check?: string; uncheck?: string },
    globalOpts: GlobalCliOptions
  ): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const task = service.getTask(id);
      if (!task) {
        OutputFormatter.printError(`Task not found: ${id}`, globalOpts);
        return;
      }

      let content = task.description || "";

      if (options.check !== undefined) {
        const target = /^\d+$/.test(options.check) ? parseInt(options.check, 10) : options.check;
        content = ChecklistService.checkItem(content, target, true);
        service.updateTask(id, { description: content });
      } else if (options.uncheck !== undefined) {
        const target = /^\d+$/.test(options.uncheck) ? parseInt(options.uncheck, 10) : options.uncheck;
        content = ChecklistService.checkItem(content, target, false);
        service.updateTask(id, { description: content });
      }

      const report = ChecklistService.parse(content);
      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`\nChecklist for ${task.id} (${report.completed}/${report.total} completed - ${report.percent}%):`);
        for (const item of report.items) {
          const mark = item.checked ? "✓ [x]" : "○ [ ]";
          console.log(`  ${item.index}: ${mark} ${item.text}`);
        }
        console.log();
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static comment(id: string, message: string, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      service.addComment(id, message);
      OutputFormatter.printSuccess(`Logged comment on ${id}`, globalOpts, { id, message });
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static history(id: string, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const events = service.getTaskHistory(id);
      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }

      console.log(`\nEvent History for ${id}:`);
      for (const ev of events) {
        const dateStr = new Date(ev.timestamp).toLocaleString();
        console.log(`  [${dateStr}] ${ev.eventType.toUpperCase()}: ${ev.payload}`);
      }
      console.log();
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      db.close();
    }
  }

  public static claim(
    id: string,
    options: { worker: string; lease?: string },
    globalOpts: GlobalCliOptions
  ): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const lease = options.lease ? parseInt(options.lease, 10) : 300;
      const claimResult = service.getClaimsService().claimTask(id, options.worker, lease);
      // Auto-set task to in_progress
      service.updateTask(id, { status: "in_progress" });

      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify({ success: true, claim: claimResult }, null, 2));
      } else {
        OutputFormatter.printSuccess(
          `Claimed task ${id} for worker '${options.worker}' (lease: ${lease}s)`,
          globalOpts,
          claimResult
        );
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static release(id: string, options: { worker: string }, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const released = service.getClaimsService().releaseClaim(id, options.worker);
      if (released) {
        OutputFormatter.printSuccess(`Released claim on ${id} by worker '${options.worker}'`, globalOpts);
      } else {
        OutputFormatter.printError(`No active claim found on ${id} for worker '${options.worker}'`, globalOpts);
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static decompose(
    id: string,
    options: { template: string },
    globalOpts: GlobalCliOptions
  ): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const children = service.decomposeTask(id, options.template);
      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(children, null, 2));
      } else {
        OutputFormatter.printSuccess(
          `Decomposed task ${id} into ${children.length} subtasks using template '${options.template}'`
        );
        OutputFormatter.printTaskList(children, globalOpts);
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static templates(globalOpts: GlobalCliOptions): void {
    const templates = DecompositionTemplateService.listTemplates();
    if (OutputFormatter.isJsonMode(globalOpts)) {
      console.log(JSON.stringify(templates, null, 2));
      return;
    }

    console.log("\nAvailable Decomposition Templates:");
    for (const tmpl of templates) {
      console.log(`  • ${tmpl.name}: ${tmpl.description} (${tmpl.subtasks.length} subtasks)`);
    }
    console.log();
  }

  public static context(globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const gitContext = GitContextResolver.resolve();
      const activeTask = service.getActiveTask();
      let parentTask = null;
      let checklistReport = null;

      if (activeTask) {
        if (activeTask.parentId) {
          parentTask = service.getTask(activeTask.parentId);
        }
        if (activeTask.description) {
          checklistReport = ChecklistService.parse(activeTask.description);
        }
      }

      const contextPayload = {
        workspace: {
          id: gitContext.workspaceId,
          root: gitContext.repoRoot,
          branch: gitContext.currentBranch,
          isWorktree: gitContext.isWorktree,
        },
        activeTask: activeTask
          ? {
              id: activeTask.id,
              title: activeTask.title,
              status: activeTask.status,
              priority: activeTask.priority,
              branch: activeTask.branch,
              parent: parentTask ? { id: parentTask.id, title: parentTask.title } : null,
              checklist: checklistReport,
            }
          : null,
      };

      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(contextPayload, null, 2));
        return;
      }

      console.log("\n=== SHADOW AGENT EXECUTION CONTEXT ===");
      console.log(`Workspace: ${gitContext.workspaceId} (${gitContext.repoRoot})`);
      console.log(`Branch:    ${gitContext.currentBranch} (Worktree: ${gitContext.isWorktree ? "Yes" : "No"})`);
      if (activeTask) {
        console.log(`Active:    ${activeTask.id} - ${activeTask.title} [${activeTask.status.toUpperCase()}]`);
        if (parentTask) {
          console.log(`Parent:    ${parentTask.id} - ${parentTask.title}`);
        }
        if (checklistReport && checklistReport.total > 0) {
          console.log(`Checklist: ${checklistReport.completed}/${checklistReport.total} completed (${checklistReport.percent}%)`);
          for (const item of checklistReport.items) {
            const mark = item.checked ? "[x]" : "[ ]";
            console.log(`  - ${mark} ${item.text}`);
          }
        }
      } else {
        console.log("Active:    None (run 'shadow task active --auto-create <title>' to start)");
      }
      console.log("======================================\n");
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      db.close();
    }
  }

  public static delete(id: string, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const deleted = service.deleteTask(id);
      if (!deleted) {
        OutputFormatter.printError(`Task not found: ${id}`, globalOpts);
        return;
      }
      OutputFormatter.printSuccess(`Deleted task ${id}`, globalOpts, { id });
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static search(query: string, options: { limit?: string }, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const limit = options.limit ? parseInt(options.limit, 10) : 20;
      const results = service.searchTasks(query, limit);

      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No tasks matching "${query}".`);
        return;
      }

      console.log(`\nSearch results for "${query}":`);
      for (const res of results) {
        console.log(`  - ${res.id}: ${res.title}`);
      }
      console.log();
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      db.close();
    }
  }

  public static tree(id: string | undefined, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const treeNodes = service.getTaskTree(id);
      OutputFormatter.printTaskTree(treeNodes, globalOpts);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
    } finally {
      db.close();
    }
  }
}
