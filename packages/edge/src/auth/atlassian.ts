import { Hono } from "hono";
import crypto from "node:crypto";
import { DistributedTokenMutex, type TokenData } from "./token_mutex";

export interface EdgeEnv {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  WEBHOOK_QUEUE: Queue;
  ATLASSIAN_CLIENT_ID?: string;
  ATLASSIAN_CLIENT_SECRET?: string;
  ATLASSIAN_REDIRECT_URI?: string;
}

export const atlassianAuthRouter = new Hono<{ Bindings: EdgeEnv }>();

/**
 * Initiates Atlassian OAuth 2.0 3LO authorization flow (SHD-CF-004).
 */
atlassianAuthRouter.get("/authorize", async (c) => {
  const clientId = c.env.ATLASSIAN_CLIENT_ID || "mock-client-id";
  const redirectUri =
    c.env.ATLASSIAN_REDIRECT_URI || new URL("/v1/auth/jira/callback", c.req.url).toString();

  const state = crypto.randomUUID();
  // Store state nonce with 10-minute expiration
  await c.env.OAUTH_KV.put(`state:${state}`, "valid", { expirationTtl: 600 });

  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId,
    scope: "read:jira-work write:jira-work read:jira-user offline_access",
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  });

  const authUrl = `https://auth.atlassian.com/authorize?${params.toString()}`;
  return c.redirect(authUrl);
});

/**
 * Handles OAuth callback and token exchange (SHD-CF-005).
 */
atlassianAuthRouter.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing authorization code or state parameter" }, 400);
  }

  // Validate state nonce against Cloudflare KV
  const storedState = await c.env.OAUTH_KV.get(`state:${state}`);
  if (!storedState) {
    return c.json({ error: "Invalid or expired OAuth state nonce" }, 403);
  }
  await c.env.OAUTH_KV.delete(`state:${state}`);

  const clientId = c.env.ATLASSIAN_CLIENT_ID || "mock-client-id";
  const clientSecret = c.env.ATLASSIAN_CLIENT_SECRET || "mock-client-secret";
  const redirectUri =
    c.env.ATLASSIAN_REDIRECT_URI || new URL("/v1/auth/jira/callback", c.req.url).toString();

  // Exchange code for tokens
  let tokenData: TokenData;
  if (clientId === "mock-client-id") {
    // Mock simulation mode for unit/miniflare tests
    tokenData = {
      accessToken: `mock-access-token-${Date.now()}`,
      refreshToken: `mock-refresh-token-${Date.now()}`,
      expiresIn: 3600,
      obtainedAt: Date.now(),
      userId: "default-user",
    };
  } else {
    const res = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ error: `Token exchange failed: ${err}` }, 400);
    }

    const json = (await res.json()) as any;
    tokenData = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      obtainedAt: Date.now(),
      userId: "default-user",
    };
  }

  // Store in KV with distributed mutex
  const mutex = new DistributedTokenMutex(c.env.OAUTH_KV);
  await mutex.storeToken(tokenData.userId, tokenData);

  return c.json({
    success: true,
    message: "Atlassian OAuth authorization successful",
    userId: tokenData.userId,
    expiresIn: tokenData.expiresIn,
  });
});

/**
 * Distributed token refresh endpoint (SHD-CF-006).
 */
atlassianAuthRouter.post("/refresh", async (c) => {
  const userId = c.req.query("userId") || "default-user";
  const mutex = new DistributedTokenMutex(c.env.OAUTH_KV);

  try {
    const result = await mutex.rotateTokenWithMutex(userId, async (oldRefreshToken) => {
      const clientId = c.env.ATLASSIAN_CLIENT_ID || "mock-client-id";
      const clientSecret = c.env.ATLASSIAN_CLIENT_SECRET || "mock-client-secret";

      if (clientId === "mock-client-id") {
        return {
          accessToken: `mock-rotated-access-${Date.now()}`,
          refreshToken: `mock-rotated-refresh-${Date.now()}`,
          expiresIn: 3600,
          obtainedAt: Date.now(),
          userId,
        };
      }

      const res = await fetch("https://auth.atlassian.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: oldRefreshToken,
        }),
      });

      if (!res.ok) {
        throw new Error(`Atlassian token rotation rejected: ${await res.text()}`);
      }

      const json = (await res.json()) as any;
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresIn: json.expires_in,
        obtainedAt: Date.now(),
        userId,
      };
    });

    return c.json({
      success: true,
      accessToken: result.accessToken,
      fromCache: result.fromCache,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
