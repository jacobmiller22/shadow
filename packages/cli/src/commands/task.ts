import { Database } from "bun:sqlite";
import {
  TaskService,
  SQLiteConnectionFactory,
  MigrationsEngine,
  EnvironmentResolver,
} from "@shadow/shared";
import { OutputFormatter, type FormatterOptions } from "../formatters/output";
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
      });

      if (OutputFormatter.isJsonMode(globalOpts)) {
        OutputFormatter.printTask(task, globalOpts);
      } else {
        OutputFormatter.printSuccess(`Created task ${task.id}`, globalOpts, task);
        OutputFormatter.printTask(task, globalOpts);
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
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
        process.exitCode = 1;
        return;
      }
      OutputFormatter.printTask(task, globalOpts);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    } finally {
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
      process.exitCode = 1;
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
      process.exitCode = 1;
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static close(id: string, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const task = service.updateTask(id, { status: "done" });
      OutputFormatter.printSuccess(`Closed task ${id}`, globalOpts, task);
      OutputFormatter.printTask(task, globalOpts);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    } finally {
      SQLiteConnectionFactory.checkpoint(db);
      db.close();
    }
  }

  public static delete(id: string, globalOpts: GlobalCliOptions): void {
    const { service, db } = this.getService(globalOpts);
    try {
      const deleted = service.deleteTask(id);
      if (!deleted) {
        OutputFormatter.printError(`Task not found: ${id}`, globalOpts);
        process.exitCode = 1;
        return;
      }
      OutputFormatter.printSuccess(`Deleted task ${id}`, globalOpts, { id });
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
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
      process.exitCode = 1;
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
      process.exitCode = 1;
    } finally {
      db.close();
    }
  }
}
