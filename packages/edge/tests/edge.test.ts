import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import app from "../src/index";
import { MockKVNamespace, MockD1Database, MockQueue } from "./mocks";
import type { EdgeEnv } from "../src/auth/atlassian";

describe("Milestone 2 Cloudflare Edge Bridge Tests", () => {
  let mockKv: MockKVNamespace;
  let mockD1: MockD1Database;
  let mockQueue: MockQueue;
  let env: EdgeEnv;

  beforeEach(() => {
    const schemaSql = fs.readFileSync(path.resolve(__dirname, "../d1/schema.sql"), "utf-8");
    mockKv = new MockKVNamespace();
    mockD1 = new MockD1Database(schemaSql);
    mockQueue = new MockQueue();

    env = {
      DB: mockD1 as any,
      OAUTH_KV: mockKv as any,
      WEBHOOK_QUEUE: mockQueue as any,
      ATLASSIAN_CLIENT_ID: "mock-client-id",
      ATLASSIAN_CLIENT_SECRET: "mock-client-secret",
    };
  });

  afterEach(() => {
    mockD1.close();
  });

  test("SHD-CF-013: Health and Telemetry endpoints", async () => {
    // Health check
    const healthRes = await app.fetch(new Request("http://localhost/health"), env);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as any;
    expect(healthJson.status).toBe("healthy");
    expect(healthJson.checks.d1).toBe("ok");
    expect(healthJson.checks.kv).toBe("ok");

    // Telemetry
    const telemRes = await app.fetch(new Request("http://localhost/v1/telemetry"), env);
    expect(telemRes.status).toBe(200);
    const telemJson = (await telemRes.json()) as any;
    expect(telemJson.service).toBe("shadow-edge");
    expect(telemJson.version).toBe("2.0.0");
  });

  test("SHD-CF-004 & SHD-CF-005: Atlassian OAuth authorize and callback flow", async () => {
    // Authorize generates state nonce and redirects
    const authRes = await app.fetch(new Request("http://localhost/v1/auth/jira/authorize"), env);
    expect(authRes.status).toBe(302);
    const location = authRes.headers.get("Location")!;
    expect(location.includes("auth.atlassian.com/authorize")).toBe(true);

    const parsedUrl = new URL(location);
    const stateNonce = parsedUrl.searchParams.get("state")!;
    expect(stateNonce).not.toBeNull();

    // Verify state was saved to KV
    const storedState = await mockKv.get(`state:${stateNonce}`);
    expect(storedState).toBe("valid");

    // Callback with code and state
    const callbackRes = await app.fetch(
      new Request(`http://localhost/v1/auth/jira/callback?code=test-auth-code&state=${stateNonce}`),
      env
    );
    expect(callbackRes.status).toBe(200);
    const callbackJson = (await callbackRes.json()) as any;
    expect(callbackJson.success).toBe(true);

    // State nonce should be consumed/deleted
    const deletedState = await mockKv.get(`state:${stateNonce}`);
    expect(deletedState).toBeNull();

    // Token should be saved in KV
    const storedToken = await mockKv.get("token:default-user");
    expect(storedToken).not.toBeNull();
  });

  test("SHD-CF-006: Distributed Token Refresh Mutex with 60s grace period cache", async () => {
    // Setup initial token in KV
    await mockKv.put(
      "token:default-user",
      JSON.stringify({
        accessToken: "initial-access-token",
        refreshToken: "initial-refresh-token",
        expiresIn: 3600,
        obtainedAt: Date.now(),
        userId: "default-user",
      })
    );

    // First refresh: executes rotation
    const refreshRes1 = await app.fetch(
      new Request("http://localhost/v1/auth/jira/refresh?userId=default-user", { method: "POST" }),
      env
    );
    expect(refreshRes1.status).toBe(200);
    const json1 = (await refreshRes1.json()) as any;
    expect(json1.success).toBe(true);
    expect(json1.fromCache).toBe(false);

    // Immediate second refresh: served from 60-second grace-period cache (ADR-003)
    const refreshRes2 = await app.fetch(
      new Request("http://localhost/v1/auth/jira/refresh?userId=default-user", { method: "POST" }),
      env
    );
    expect(refreshRes2.status).toBe(200);
    const json2 = (await refreshRes2.json()) as any;
    expect(json2.success).toBe(true);
    expect(json2.fromCache).toBe(true);
    expect(json2.accessToken).toBe(json1.accessToken);
  });

  test("SHD-CF-007: Webhook ingestion with SHA256 deduplication and queue push", async () => {
    const webhookPayload = {
      webhookEvent: "jira:issue_updated",
      issue: {
        key: "PROJ-42",
        fields: {
          summary: "Update payment gateway configuration",
          status: { name: "In Progress" },
        },
      },
    };

    // First ingestion: accepted and queued
    const res1 = await app.fetch(
      new Request("http://localhost/v1/webhooks/jira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      }),
      env
    );
    expect(res1.status).toBe(202);
    const json1 = (await res1.json()) as any;
    expect(json1.status).toBe("accepted");
    expect(mockQueue.messages.length).toBe(1);

    // Duplicate ingestion with same body: deduplicated via KV hash
    const res2 = await app.fetch(
      new Request("http://localhost/v1/webhooks/jira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      }),
      env
    );
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as any;
    expect(json2.status).toBe("deduplicated");
    expect(mockQueue.messages.length).toBe(1); // No new queue message
  });

  test("SHD-CF-009 & SHD-CF-010: Edge sync push and pull against Cloudflare D1", async () => {
    const mutations = [
      {
        entityType: "task",
        entityId: "SHD-0001",
        action: "create" as const,
        payload: JSON.stringify({
          workspaceId: "ws-test",
          title: "Edge Synced Task",
          status: "in_progress",
          priority: "high",
        }),
        createdAt: Date.now(),
      },
    ];

    // Push mutations to edge
    const pushRes = await app.fetch(
      new Request("http://localhost/v1/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations }),
      }),
      env
    );
    expect(pushRes.status).toBe(200);
    const pushJson = (await pushRes.json()) as any;
    expect(pushJson.success).toBe(true);
    expect(pushJson.processed).toBe(1);

    // Pull tasks from edge
    const pullRes = await app.fetch(
      new Request("http://localhost/v1/sync/pull?workspaceId=ws-test&since=0"),
      env
    );
    expect(pullRes.status).toBe(200);
    const pullJson = (await pullRes.json()) as any;
    expect(pullJson.success).toBe(true);
    expect(pullJson.tasks.length).toBe(1);
    expect(pullJson.tasks[0].id).toBe("SHD-0001");
    expect(pullJson.tasks[0].title).toBe("Edge Synced Task");
  });

  test("SHD-CF-011: Device authorization pairing flow", async () => {
    // 1. Request device code
    const codeRes = await app.fetch(
      new Request("http://localhost/v1/auth/device/code", { method: "POST" }),
      env
    );
    expect(codeRes.status).toBe(200);
    const codeJson = (await codeRes.json()) as any;
    expect(codeJson.device_code).not.toBeNull();
    expect(codeJson.user_code).not.toBeNull();

    // 2. Poll token before approval -> 428 authorization_pending
    const pollPending = await app.fetch(
      new Request("http://localhost/v1/auth/device/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: codeJson.device_code }),
      }),
      env
    );
    expect(pollPending.status).toBe(428);

    // 3. User approves code in browser
    const approveRes = await app.fetch(
      new Request("http://localhost/v1/auth/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_code: codeJson.user_code, user_id: "dev-user-1" }),
      }),
      env
    );
    expect(approveRes.status).toBe(200);

    // 4. Poll token after approval -> 200 with Bearer token
    const pollApproved = await app.fetch(
      new Request("http://localhost/v1/auth/device/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: codeJson.device_code }),
      }),
      env
    );
    expect(pollApproved.status).toBe(200);
    const tokenJson = (await pollApproved.json()) as any;
    expect(tokenJson.access_token.startsWith("shd_live_")).toBe(true);
    expect(tokenJson.user_id).toBe("dev-user-1");
  });
});
