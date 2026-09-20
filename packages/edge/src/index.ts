import { Hono } from "hono";
import { cors } from "hono/cors";
import { atlassianAuthRouter, type EdgeEnv } from "./auth/atlassian";
import { deviceAuthRouter } from "./auth/device";
import { webhookRouter, handleWebhookQueueBatch, type JiraWebhookMessage } from "./queues/webhooks";
import { syncRouter } from "./sync/routes";
import { createRateLimiter } from "./middleware/rate_limit";

const app = new Hono<{ Bindings: EdgeEnv }>();

// Enable CORS for web viewer and CLI clients
app.use("*", cors());

// Rate limit auth and webhook routes (SHD-CF-012)
app.use("/v1/auth/*", createRateLimiter(30, 60));
app.use("/v1/webhooks/*", createRateLimiter(120, 60));

// Mount Sub-Routers
app.route("/v1/auth/jira", atlassianAuthRouter);
app.route("/v1/auth/device", deviceAuthRouter);
app.route("/v1/webhooks", webhookRouter);
app.route("/v1/sync", syncRouter);

/**
 * Edge Health Probe Endpoint (SHD-CF-013).
 */
app.get("/health", async (c) => {
  const start = Date.now();
  let d1Healthy = false;
  let kvHealthy = false;

  try {
    if (c.env?.DB) {
      await c.env.DB.prepare("SELECT 1;").run();
      d1Healthy = true;
    }
  } catch {}

  try {
    if (c.env?.OAUTH_KV) {
      await c.env.OAUTH_KV.get("health:probe");
      kvHealthy = true;
    }
  } catch {}

  const durationMs = Date.now() - start;
  const isHealthy = (!c.env?.DB || d1Healthy) && (!c.env?.OAUTH_KV || kvHealthy);

  return c.json(
    {
      status: isHealthy ? "healthy" : "degraded",
      durationMs,
      checks: {
        d1: d1Healthy ? "ok" : "skipped/unavailable",
        kv: kvHealthy ? "ok" : "skipped/unavailable",
      },
      timestamp: Date.now(),
    },
    isHealthy ? 200 : 503
  );
});

/**
 * Edge Telemetry & Diagnostics (SHD-CF-013).
 */
app.get("/v1/telemetry", (c) => {
  const cf = (c.req.raw as any).cf || {};
  return c.json({
    service: "shadow-edge",
    version: "2.0.0",
    colo: cf.colo || "LOCAL",
    country: cf.country || "US",
    clientIp: c.req.header("cf-connecting-ip") || "127.0.0.1",
    timestamp: Date.now(),
  });
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<JiraWebhookMessage>, env: EdgeEnv): Promise<void> {
    await handleWebhookQueueBatch(batch, env);
  },
};
