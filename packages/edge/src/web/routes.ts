import { Hono } from "hono";
import type { EdgeEnv } from "../auth/atlassian";

export const webRouter = new Hono<{ Bindings: EdgeEnv }>();

// Auth middleware for web viewer (SHD-WEB-003)
webRouter.use("*", async (c, next) => {
  const cfClientId = c.req.header("CF-Access-Client-Id");
  const authHeader = c.req.header("Authorization");
  const expectedToken = (c.env as any).SHADOW_WEB_TOKEN;

  // In production/staging with configured token, require authentication
  if (expectedToken) {
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const isServiceTokenValid = Boolean(cfClientId);
    const isBearerValid = bearer === expectedToken;

    if (!isServiceTokenValid && !isBearerValid) {
      return c.json({ error: "Unauthorized: Valid CF-Access or Bearer token required" }, 401);
    }
  }

  await next();
});

/**
 * Summary metrics endpoint for stakeholder dashboard (SHD-WEB-002)
 */
webRouter.get("/summary", async (c) => {
  const tasksRes = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
       SUM(CASE WHEN status = 'todo' OR status = 'blocked' THEN 1 ELSE 0 END) as todo,
       COUNT(DISTINCT workspace_id) as workspaces
     FROM tasks;`
  ).first() as any;

  const total = tasksRes?.total || 0;
  const done = tasksRes?.done || 0;
  const inProgress = tasksRes?.in_progress || 0;
  const todo = tasksRes?.todo || 0;
  const workspaces = tasksRes?.workspaces || 0;
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

  return c.json({
    total,
    done,
    inProgress,
    todo,
    workspaces,
    completionRate,
    timestamp: Date.now(),
  });
});

/**
 * Tasks list endpoint with filtering (SHD-WEB-002)
 */
webRouter.get("/tasks", async (c) => {
  const status = c.req.query("status");
  const workspaceId = c.req.query("workspace_id");
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);

  let query = `SELECT * FROM tasks WHERE 1=1`;
  const params: any[] = [];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  if (workspaceId) {
    query += ` AND workspace_id = ?`;
    params.push(workspaceId);
  }

  query += ` ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);

  const stmt = c.env.DB.prepare(query);
  const rows = (await stmt.bind(...params).all()).results || [];

  return c.json({
    tasks: rows,
    count: rows.length,
  });
});

/**
 * Task detail endpoint with events & relations
 */
webRouter.get("/tasks/:id", async (c) => {
  const id = c.req.param("id");

  const task = await c.env.DB.prepare(`SELECT * FROM tasks WHERE id = ?;`).bind(id).first();
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const events = (
    await c.env.DB.prepare(
      `SELECT * FROM task_events WHERE task_id = ? ORDER BY timestamp DESC LIMIT 20;`
    )
      .bind(id)
      .all()
  ).results || [];

  const relations = (
    await c.env.DB.prepare(
      `SELECT * FROM task_relations WHERE source_id = ? OR target_id = ?;`
    )
      .bind(id, id)
      .all()
  ).results || [];

  return c.json({
    task,
    events,
    relations,
  });
});
