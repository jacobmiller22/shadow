import {
  RemoteLinkService,
  TaskService,
  EnvironmentResolver,
  SQLiteConnectionFactory,
} from "@shadow/shared";
import type { GlobalCliOptions } from "./task";
import { OutputFormatter } from "../formatters/output";

export class LinkCommandHandler {
  private static getDb(globalOpts: GlobalCliOptions) {
    const dbPath = EnvironmentResolver.resolveDatabasePath({
      explicitPath: globalOpts.dbPath,
      envOverride: globalOpts.env,
    });
    return SQLiteConnectionFactory.open(dbPath);
  }

  /**
   * Links a task to a remote issue (e.g. jira:PROJ-101 or PROJ-101)
   */
  public static link(
    taskId: string,
    remoteKeyInput: string,
    options: { url?: string },
    globalOpts: GlobalCliOptions
  ): void {
    const db = this.getDb(globalOpts);
    try {
      const taskService = new TaskService(db);
      const linkService = new RemoteLinkService(db);

      const task = taskService.getTask(taskId);
      if (!task) {
        OutputFormatter.printError(new Error(`Task ${taskId} not found`), globalOpts);
        process.exitCode = 1;
        return;
      }

      let remoteSystem: "jira" | "github" = "jira";
      let remoteKey = remoteKeyInput;

      if (remoteKeyInput.includes(":")) {
        const [sys, key] = remoteKeyInput.split(":", 2);
        if (sys === "gh" || sys === "github") {
          remoteSystem = "github";
        } else {
          remoteSystem = "jira";
        }
        remoteKey = key;
      }

      const record = linkService.linkTask(taskId, remoteSystem, remoteKey, options.url);
      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify({ success: true, link: record }, null, 2));
      } else {
        OutputFormatter.printSuccess(`Linked task ${taskId} to ${remoteSystem}:${remoteKey}`);
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  }

  /**
   * Unlinks a task from a remote issue
   */
  public static unlink(
    taskId: string,
    remoteKeyInput: string,
    globalOpts: GlobalCliOptions
  ): void {
    const db = this.getDb(globalOpts);
    try {
      const linkService = new RemoteLinkService(db);

      let remoteSystem: "jira" | "github" = "jira";
      let remoteKey = remoteKeyInput;

      if (remoteKeyInput.includes(":")) {
        const [sys, key] = remoteKeyInput.split(":", 2);
        if (sys === "gh" || sys === "github") {
          remoteSystem = "github";
        } else {
          remoteSystem = "jira";
        }
        remoteKey = key;
      }

      const removed = linkService.unlinkTask(taskId, remoteSystem, remoteKey);
      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify({ success: removed, taskId, remoteKey }, null, 2));
      } else {
        if (removed) {
          OutputFormatter.printSuccess(`Unlinked task ${taskId} from ${remoteSystem}:${remoteKey}`);
        } else {
          console.log(`No link found for task ${taskId} and ${remoteSystem}:${remoteKey}`);
        }
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  }

  /**
   * Lists all remote links for a task
   */
  public static list(taskId: string, globalOpts: GlobalCliOptions): void {
    const db = this.getDb(globalOpts);
    try {
      const linkService = new RemoteLinkService(db);
      const links = linkService.getLinksForTask(taskId);

      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(links, null, 2));
      } else {
        if (links.length === 0) {
          console.log(`No remote links found for task ${taskId}.`);
        } else {
          console.log(`Remote links for task ${taskId}:`);
          for (const l of links) {
            console.log(`  • ${l.remoteSystem}:${l.remoteKey} (last synced: ${new Date(l.lastSyncedAt).toLocaleString()})`);
          }
        }
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  }
}
