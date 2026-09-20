import { Hono } from "hono";
import crypto from "node:crypto";
import type { EdgeEnv } from "./atlassian";

export const deviceAuthRouter = new Hono<{ Bindings: EdgeEnv }>();

function generateUserCode(): string {
  const chars = "BCDFGHJKLMNPQRSTVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += "-";
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Initiates Device Authorization Flow (SHD-CF-011).
 */
deviceAuthRouter.post("/code", async (c) => {
  const deviceCode = crypto.randomUUID();
  const userCode = generateUserCode();
  const now = Date.now();
  const expiresIn = 900; // 15 minutes
  const expiresAt = now + expiresIn * 1000;

  await c.env.DB.prepare(
    `INSERT INTO device_codes (device_code, user_code, expires_at, status)
     VALUES (?, ?, ?, 'pending');`
  )
    .bind(deviceCode, userCode, expiresAt)
    .run();

  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${baseUrl}/auth/device/verify`,
    verification_uri_complete: `${baseUrl}/auth/device/verify?user_code=${userCode}`,
    expires_in: expiresIn,
    interval: 5,
  });
});

/**
 * Polls for Device Authorization Token (SHD-CF-011).
 */
deviceAuthRouter.post("/token", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const deviceCode = body.device_code;
  if (!deviceCode) {
    return c.json({ error: "Missing device_code" }, 400);
  }

  const row = (await c.env.DB.prepare(
    `SELECT * FROM device_codes WHERE device_code = ?;`
  )
    .bind(deviceCode)
    .first()) as any;

  if (!row) {
    return c.json({ error: "invalid_grant", message: "Unknown device code" }, 400);
  }

  if (Date.now() > row.expires_at) {
    return c.json({ error: "expired_token", message: "Device code expired" }, 400);
  }

  if (row.status === "pending") {
    return c.json({ error: "authorization_pending" }, 428);
  }

  if (row.status === "rejected") {
    return c.json({ error: "access_denied" }, 403);
  }

  // Generate bearer token for paired CLI
  const bearerToken = `shd_live_${crypto.randomUUID()}`;
  await c.env.OAUTH_KV.put(`bearer:${bearerToken}`, row.user_id || "default-user", {
    expirationTtl: 30 * 86400, // 30 days
  });

  // Delete used device code
  await c.env.DB.prepare(`DELETE FROM device_codes WHERE device_code = ?;`).bind(deviceCode).run();

  return c.json({
    access_token: bearerToken,
    token_type: "Bearer",
    expires_in: 30 * 86400,
    user_id: row.user_id || "default-user",
  });
});

/**
 * Approves a device authorization code (User Web Action).
 */
deviceAuthRouter.post("/approve", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const userCode = body.user_code;
  const userId = body.user_id || "default-user";

  const res = await c.env.DB.prepare(
    `UPDATE device_codes SET status = 'approved', user_id = ?
     WHERE user_code = ? AND status = 'pending' AND expires_at > ?;`
  )
    .bind(userId, userCode, Date.now())
    .run();

  if (res.meta.changes === 0) {
    return c.json({ error: "Invalid or expired user code" }, 400);
  }

  return c.json({ success: true, message: "Device authorized successfully" });
});
