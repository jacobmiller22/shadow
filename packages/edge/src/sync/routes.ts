import { Hono } from "hono";
import type { EdgeEnv } from "../auth/atlassian";

export const syncRouter = new Hono<{ Bindings: EdgeEnv }>();

export interface SyncPushItem {
  id?: number;
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete";
  payload: string; // JSON
  createdAt: number;
}

/**
 * Edge Sync Push Endpoint (SHD-CF-009).
 * Commits a batch of offline mutations to Cloudflare D1.
 */
syncRouter.post("/push", async (c) => {
  let items: SyncPushItem[];
  try {
    const body = await c.req.json();
    items = Array.isArray(body) ? body : body.mutations;
    if (!Array.isArray(items)) {
      return c.json({ error: "Invalid payload: expected mutations array" }, 400);
    }
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const results: Array<{ entityId: string; status: "synced" | "failed"; error?: string }> = [];

  for (const item of items) {
    try {
      if (item.entityType === "task") {
        if (item.action === "create" || item.action === "update") {
          const task = JSON.parse(item.payload);
          await c.env.DB.prepare(
            `INSERT INTO tasks (id, workspace_id, title, description, status, priority, parent_id, branch, metadata, created_at, updated_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               description = excluded.description,
               status = excluded.status,
               priority = excluded.priority,
               parent_id = excluded.parent_id,
               branch = excluded.branch,
               metadata = excluded.metadata,
               updated_at = excluded.updated_at,
               completed_at = excluded.completed_at;`
          )
            .bind(
              item.entityId,
              task.workspaceId || "default",
              task.title || "Untitled",
              task.description || null,
              task.status || "todo",
              task.priority || "medium",
              task.parentId || null,
              task.branch || null,
              task.metadata || null,
              task.createdAt || Date.now(),
              task.updatedAt || Date.now(),
              task.completedAt || null
            )
            .run();
        } else if (item.action === "delete") {
          await c.env.DB.prepare(`DELETE FROM tasks WHERE id = ?;`).bind(item.entityId).run();
        }
      }

      results.push({ entityId: item.entityId, status: "synced" });
    } catch (err: any) {
      results.push({ entityId: item.entityId, status: "failed", error: err.message });
    }
  }

  return c.json({
    success: true,
    processed: results.length,
    results,
    serverTimestamp: Date.now(),
  });
});

/**
 * Edge Sync Pull Endpoint (SHD-CF-010).
 * Retrieves modified tasks and relations from Cloudflare D1 since a given timestamp.
 */
syncRouter.get("/pull", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const sinceParam = c.req.query("since");
  const sinceTimestamp = sinceParam ? parseInt(sinceParam, 10) : 0;

  let query = "SELECT * FROM tasks WHERE updated_at > ?";
  const binds: any[] = [sinceTimestamp];

  if (workspaceId) {
    query += " AND workspace_id = ?";
    binds.push(workspaceId);
  }

  query += " ORDER BY updated_at ASC LIMIT 500;";

  const tasksStmt = c.env.DB.prepare(query);
  const tasksResult = await tasksStmt.bind(...binds).all();

  return c.json({
    success: true,
    tasks: tasksResult.results || [],
    since: sinceTimestamp,
    serverTimestamp: Date.now(),
  });
});
