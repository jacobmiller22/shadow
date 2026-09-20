import { Hono } from "hono";
import crypto from "node:crypto";
import type { EdgeEnv } from "../auth/atlassian";

export const webhookRouter = new Hono<{ Bindings: EdgeEnv }>();

export interface JiraWebhookMessage {
  id: string;
  timestamp: number;
  webhookEvent: string;
  issue: any;
  user?: any;
}

/**
 * Asynchronous Jira Webhook Ingestion Endpoint (SHD-CF-007).
 */
webhookRouter.post("/jira", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const webhookEvent = body.webhookEvent || "jira:issue_updated";
  const issueKey = body.issue?.key || "UNKNOWN";
  const rawPayload = JSON.stringify(body);

  // Compute SHA256 deduplication hash (SHD-CF-007)
  const hash = crypto.createHash("sha256").update(rawPayload).digest("hex");
  const dedupKey = `webhook:dedup:${hash}`;

  const alreadySeen = await c.env.OAUTH_KV.get(dedupKey);
  if (alreadySeen) {
    return c.json({ status: "deduplicated", message: "Event already queued" }, 200);
  }

  // Record dedup key in KV with 10-minute TTL
  await c.env.OAUTH_KV.put(dedupKey, "queued", { expirationTtl: 600 });

  const message: JiraWebhookMessage = {
    id: hash,
    timestamp: Date.now(),
    webhookEvent,
    issue: body.issue,
    user: body.user,
  };

  // Push to Cloudflare Queue producer
  await c.env.WEBHOOK_QUEUE.send(message);

  return c.json(
    {
      status: "accepted",
      eventId: hash,
      issueKey,
      event: webhookEvent,
    },
    202
  );
});

/**
 * Cloudflare Queues consumer handler (SHD-CF-008).
 */
export async function handleWebhookQueueBatch(batch: MessageBatch<JiraWebhookMessage>, env: EdgeEnv): Promise<void> {
  for (const message of batch.messages) {
    const payload = message.body;
    const issueKey = payload.issue?.key;
    const summary = payload.issue?.fields?.summary || "Jira Synced Task";
    const status = payload.issue?.fields?.status?.name || "todo";
    const description = payload.issue?.fields?.description || null;

    try {
      // 1. Record event in D1 task_events
      await env.DB.prepare(
        `INSERT INTO task_events (task_id, event_type, payload, timestamp)
         VALUES (?, ?, ?, ?);`
      )
        .bind(
          issueKey || "GLOBAL",
          `jira_webhook:${payload.webhookEvent}`,
          JSON.stringify(payload),
          payload.timestamp
        )
        .run();

      // 2. Upsert into D1 tasks table if issueKey is present
      if (issueKey) {
        const taskId = `JIRA-${issueKey}`;
        const now = Date.now();

        await env.DB.prepare(
          `INSERT INTO tasks (id, workspace_id, title, description, status, priority, created_at, updated_at)
           VALUES (?, 'jira-sync', ?, ?, ?, 'medium', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             description = excluded.description,
             status = excluded.status,
             updated_at = excluded.updated_at;`
        )
          .bind(taskId, summary, typeof description === "string" ? description : JSON.stringify(description), status.toLowerCase().includes("done") ? "done" : "todo", now, now)
          .run();

        // 3. Upsert remote link
        await env.DB.prepare(
          `INSERT INTO remote_links (task_id, remote_system, remote_key, last_synced_at)
           VALUES (?, 'jira', ?, ?);`
        )
          .bind(taskId, issueKey, now)
          .run();
      }

      message.ack();
    } catch (err) {
      console.error(`Error processing webhook event ${payload.id}:`, err);
      message.retry();
    }
  }
}
