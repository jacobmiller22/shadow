import type { Database } from "bun:sqlite";
import type { Task } from "../db/schema";
import { RemoteLinkService, type RemoteLinkRecord } from "./links";

export interface ProjectBatchUpdate {
  projectKey: string;
  remoteKey: string;
  tasks: Task[];
}

export class FanOutResolver {
  private db: Database;
  private linkService: RemoteLinkService;

  constructor(db: Database) {
    this.db = db;
    this.linkService = new RemoteLinkService(db);
  }

  /**
   * Resolves a parent task/epic and all its subtasks, grouping them by target remote project key.
   * e.g. PROJ-1 -> [subtask1], FRONT-20 -> [subtask2], BACK-30 -> [subtask3]
   */
  public resolveFanOutBatches(rootTaskId: string): ProjectBatchUpdate[] {
    // 1. Fetch all child/descendant tasks of rootTaskId
    const subtaskRows = this.db
      .query(`SELECT * FROM tasks WHERE parent_id = ? OR id = ?;`)
      .all(rootTaskId, rootTaskId) as Task[];

    const remoteBatchMap = new Map<string, { projectKey: string; remoteKey: string; tasks: Task[] }>();

    for (const task of subtaskRows) {
      const links = this.linkService.getLinksForTask(task.id);
      for (const link of links) {
        if (link.remoteSystem === "jira") {
          const projectKey = link.remoteKey.split("-")[0] || "DEFAULT";
          const existing = remoteBatchMap.get(link.remoteKey);
          if (existing) {
            existing.tasks.push(task);
          } else {
            remoteBatchMap.set(link.remoteKey, {
              projectKey,
              remoteKey: link.remoteKey,
              tasks: [task],
            });
          }
        }
      }
    }

    return Array.from(remoteBatchMap.values());
  }
}
