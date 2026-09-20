import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  MigrationsEngine,
  TaskService,
  ADFConverter,
  JiraSchemaResolver,
  RemoteLinkService,
  RollupGenerator,
  FanOutResolver,
  PrivacyFirewall,
  SyncQueueManager,
  ConflictResolver,
  SyncAuditLogger,
  JiraStatusTransitionEngine,
} from "../src/index";

describe("Milestone 3: Jira Sync & Mapping Engine", () => {
  let db: Database;
  let taskService: TaskService;

  beforeEach(() => {
    db = new Database(":memory:");
    MigrationsEngine.runMigrations(db);
    taskService = new TaskService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("ADF Converter (SHD-SYNC-004)", () => {
    it("converts markdown headings, lists, code blocks to ADF and back", () => {
      const markdown = [
        "# Architectural Overview",
        "This is an implementation detail.",
        "## Sub-section",
        "- Bullet item 1",
        "- Bullet item 2",
        "```typescript",
        "const x = 42;",
        "```",
        "> Important architectural note",
      ].join("\n\n");

      const adf = ADFConverter.toADF(markdown);
      expect(adf.type).toBe("doc");
      expect(adf.content.length).toBeGreaterThan(0);

      const roundtripMd = ADFConverter.toMarkdown(adf);
      expect(roundtripMd).toContain("# Architectural Overview");
      expect(roundtripMd).toContain("Bullet item 1");
      expect(roundtripMd).toContain("const x = 42;");
      expect(roundtripMd).toContain("> Important architectural note");
    });

    it("handles bold, italic, inline code and links", () => {
      const markdown = "Here is **bold**, *italic*, `code`, and [Link](https://shadow.dev).";
      const adf = ADFConverter.toADF(markdown);
      const roundtrip = ADFConverter.toMarkdown(adf);

      expect(roundtrip).toContain("**bold**");
      expect(roundtrip).toContain("*italic*");
      expect(roundtrip).toContain("`code`");
      expect(roundtrip).toContain("[Link](https://shadow.dev)");
    });
  });

  describe("Dynamic Jira Schema & Custom Field Defaults (SHD-SYNC-005, SHD-SYNC-006)", () => {
    it("caches and retrieves introspected schema", () => {
      const resolver = new JiraSchemaResolver(db);
      const schema = {
        projectKey: "PROJ",
        issueTypes: [
          {
            id: "10001",
            name: "Story",
            fields: {
              summary: { key: "summary", name: "Summary", required: true, type: "string" },
              customfield_10024: { key: "customfield_10024", name: "Root Cause", required: true, type: "string" },
            },
          },
        ],
      };

      resolver.saveSchema("PROJ", schema);
      const cached = resolver.getCachedSchema("PROJ");
      expect(cached).not.toBeNull();
      expect(cached?.projectKey).toBe("PROJ");
      expect(cached?.issueTypes[0].fields["customfield_10024"].required).toBe(true);
    });

    it("populates mandatory custom fields from configured defaults", () => {
      const resolver = new JiraSchemaResolver(db);
      const schema = {
        projectKey: "ENG",
        issueTypes: [
          {
            id: "10",
            name: "Task",
            fields: {
              summary: { key: "summary", name: "Summary", required: true, type: "string" },
              customfield_10024: { key: "customfield_10024", name: "Root Cause", required: true, type: "string" },
              customfield_99999: { key: "customfield_99999", name: "Security Tier", required: true, type: "string" },
            },
          },
        ],
      };

      const defaults = {
        customfield_10024: "Standard Maintenance",
      };

      const result = resolver.populateDefaults(
        { summary: "Fix memory leak" },
        schema,
        defaults
      );

      expect(result.enriched.customfield_10024).toBe("Standard Maintenance");
      // Security Tier is still missing
      expect(result.missingRequired).toContain("Security Tier");
    });
  });

  describe("N <-> M Remote Linking (SHD-SYNC-001)", () => {
    it("manages bidirectional links between local tasks and remote issues", () => {
      const t1 = taskService.createTask({ title: "Core Schema", workspaceId: "ws1" });
      const t2 = taskService.createTask({ title: "Migration Engine", workspaceId: "ws1" });

      const linkService = new RemoteLinkService(db);
      linkService.linkTask(t1.id, "jira", "PROJ-100", "https://jira.corp.com/browse/PROJ-100");
      linkService.linkTask(t2.id, "jira", "PROJ-100", "https://jira.corp.com/browse/PROJ-100");
      linkService.linkTask(t1.id, "github", "42");

      const t1Links = linkService.getLinksForTask(t1.id);
      expect(t1Links.length).toBe(2);

      const mappedTasks = linkService.getTasksForRemoteKey("jira", "PROJ-100");
      expect(mappedTasks).toContain(t1.id);
      expect(mappedTasks).toContain(t2.id);

      linkService.unlinkTask(t1.id, "github", "42");
      const updatedLinks = linkService.getLinksForTask(t1.id);
      expect(updatedLinks.length).toBe(1);
    });
  });

  describe("Rollup Generator (SHD-SYNC-002)", () => {
    it("aggregates subtasks into a markdown status comment and checklist", () => {
      const t1 = taskService.createTask({ title: "Task 1", workspaceId: "ws1", status: "done" });
      const t2 = taskService.createTask({ title: "Task 2", workspaceId: "ws1", status: "in_progress", branch: "feat/t2" });
      const t3 = taskService.createTask({ title: "Task 3", workspaceId: "ws1", status: "blocked" });

      const rollup = RollupGenerator.generate("PROJ-500", [
        { task: t1 },
        { task: t2 },
        { task: t3, blockers: ["Waiting on DB access"] },
      ]);

      expect(rollup.totalTasks).toBe(3);
      expect(rollup.completedTasks).toBe(1);
      expect(rollup.percentComplete).toBe(33);
      expect(rollup.markdown).toContain("33% (1/3 completed, 1 in progress)");
      expect(rollup.markdown).toContain(`- [x] **${t1.id}**: Task 1`);
      expect(rollup.markdown).toContain(`- [ ] **${t2.id}**: Task 2 *(status: in_progress)* \`branch: feat/t2\``);
      expect(rollup.markdown).toContain("Waiting on DB access");
      expect(rollup.adf.type).toBe("doc");
    });
  });

  describe("Fan-Out Resolver (SHD-SYNC-003)", () => {
    it("groups multi-project subtask updates by target project key", () => {
      const epic = taskService.createTask({ title: "Epic: Auth Overhaul", workspaceId: "ws1" });
      const sub1 = taskService.createTask({ title: "Frontend UI", parentId: epic.id, workspaceId: "ws1" });
      const sub2 = taskService.createTask({ title: "Backend API", parentId: epic.id, workspaceId: "ws1" });
      const sub3 = taskService.createTask({ title: "Infra DNS", parentId: epic.id, workspaceId: "ws1" });

      const linkService = new RemoteLinkService(db);
      linkService.linkTask(sub1.id, "jira", "FRONT-101");
      linkService.linkTask(sub2.id, "jira", "BACK-202");
      linkService.linkTask(sub3.id, "jira", "INFRA-303");

      const fanOut = new FanOutResolver(db);
      const batches = fanOut.resolveFanOutBatches(epic.id);

      expect(batches.length).toBe(3);
      const projects = batches.map((b) => b.projectKey);
      expect(projects).toContain("FRONT");
      expect(projects).toContain("BACK");
      expect(projects).toContain("INFRA");
    });
  });

  describe("Privacy & Security Firewall (SHD-SYNC-007, SHD-SYNC-008)", () => {
    it("drops tasks marked private from sync", () => {
      const publicTask = taskService.createTask({ title: "Public refactor", workspaceId: "ws1" });
      const privateTask1 = taskService.createTask({ title: "Internal audit #private", workspaceId: "ws1" });
      const privateTask2 = taskService.createTask({
        title: "Secret research",
        workspaceId: "ws1",
        metadata: { is_private: true },
      });

      expect(PrivacyFirewall.sanitizeTask(publicTask)).not.toBeNull();
      expect(PrivacyFirewall.sanitizeTask(privateTask1)).toBeNull();
      expect(PrivacyFirewall.sanitizeTask(privateTask2)).toBeNull();
    });

    it("redacts AWS keys, GitHub tokens, user home paths, and IP addresses", () => {
      const dirty = "Error in /Users/johndoe/project/app.ts using key AKIAIOSFODNN7EXAMPLE and token ghp_abcdefghijklmnopqrstuvwxyz0123456789 on 192.168.1.50";
      const result = PrivacyFirewall.redactString(dirty);

      expect(result.text).not.toContain("/Users/johndoe/");
      expect(result.text).toContain("~/project/app.ts");
      expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.text).toContain("[REDACTED_AWS_KEY]");
      expect(result.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
      expect(result.text).toContain("[REDACTED_GITHUB_TOKEN]");
      expect(result.text).not.toContain("192.168.1.50");
      expect(result.text).toContain("[REDACTED_IP]");
      expect(result.redactionsCount).toBe(4);
    });

    it("strips blacklisted metadata fields", () => {
      const task = taskService.createTask({
        title: "Clean task",
        workspaceId: "ws1",
        metadata: {
          component: "core",
          notes: "Sensitive internal thoughts",
          agent_scratchpad: "LLM temp buffer",
          stacktrace: "Error at line 99",
        },
      });

      const sanitized = PrivacyFirewall.sanitizeTask(task);
      expect(sanitized).not.toBeNull();
      const meta = JSON.parse(sanitized?.metadata || "{}");
      expect(meta.component).toBe("core");
      expect(meta.notes).toBeUndefined();
      expect(meta.agent_scratchpad).toBeUndefined();
      expect(meta.stacktrace).toBeUndefined();
    });
  });

  describe("Jira Status Transition Engine (SHD-SYNC-010)", () => {
    it("resolves transition matching target status name", () => {
      const engine = new JiraStatusTransitionEngine();
      const available = [
        { id: "11", name: "Start Work", to: { name: "In Progress" } },
        { id: "21", name: "Done", to: { name: "Done" } },
        { id: "31", name: "Reopen", to: { name: "To Do" } },
      ];

      const trDone = engine.resolveTransition("done", available);
      expect(trDone?.id).toBe("21");

      const trInProgress = engine.resolveTransition("in_progress", available);
      expect(trInProgress?.id).toBe("11");
    });
  });

  describe("Local Offline Mutation Queue (SHD-SYNC-011)", () => {
    it("enqueues and drains mutations in FIFO order", async () => {
      const queue = new SyncQueueManager(db);
      expect(queue.countPending()).toBe(0);

      const id1 = queue.enqueue("task", "SHD-1", "create", { title: "First" });
      const id2 = queue.enqueue("task", "SHD-2", "update", { title: "Second" });

      expect(queue.countPending()).toBe(2);
      const pending = queue.getPending();
      expect(pending[0].entityId).toBe("SHD-1");
      expect(pending[1].entityId).toBe("SHD-2");

      const processed: string[] = [];
      const drainResult = await queue.drain(async (item) => {
        processed.push(item.entityId);
      });

      expect(drainResult.processed).toBe(2);
      expect(drainResult.failed).toBe(0);
      expect(processed).toEqual(["SHD-1", "SHD-2"]);
      expect(queue.countPending()).toBe(0);
    });

    it("marks failed queue item with error message", async () => {
      const queue = new SyncQueueManager(db);
      const id = queue.enqueue("task", "SHD-FAIL", "delete", {});

      await queue.drain(async () => {
        throw new Error("Simulated network failure");
      });

      expect(queue.countPending()).toBe(0); // No longer pending, marked failed
      const row = db.query(`SELECT * FROM sync_queue WHERE id = ?;`).get(id) as any;
      expect(row.status).toBe("failed");
      expect(row.error).toContain("Simulated network failure");
    });
  });

  describe("3-Way Conflict Resolver (SHD-SYNC-012)", () => {
    it("fast-forwards remote when only local was modified", () => {
      const local = { id: "SHD-1", updatedAt: 200, title: "Local changes" };
      const remote = { id: "SHD-1", updatedAt: 100, title: "Original" };
      const lastSyncedAt = 100;

      const res = ConflictResolver.reconcile(local, remote, lastSyncedAt, "theirs");
      expect(res.action).toBe("fast-forward-remote");
    });

    it("fast-forwards local when only remote was modified", () => {
      const local = { id: "SHD-1", updatedAt: 100, title: "Original" };
      const remote = { id: "SHD-1", updatedAt: 200, title: "Remote changes" };
      const lastSyncedAt = 100;

      const res = ConflictResolver.reconcile(local, remote, lastSyncedAt, "theirs");
      expect(res.action).toBe("fast-forward-local");
    });

    it("resolves conflict with 'ours' strategy", () => {
      const local = { id: "SHD-1", updatedAt: 250, title: "Local branch edit" };
      const remote = { id: "SHD-1", updatedAt: 220, title: "Remote Jira edit" };
      const lastSyncedAt = 100;

      const res = ConflictResolver.reconcile(local, remote, lastSyncedAt, "ours");
      expect(res.action).toBe("conflict");
      if (res.action === "conflict") {
        expect(res.resolvedPayload.title).toBe("Local branch edit");
      }
    });

    it("resolves conflict with 'theirs' strategy", () => {
      const local = { id: "SHD-1", updatedAt: 250, title: "Local branch edit" };
      const remote = { id: "SHD-1", updatedAt: 220, title: "Remote Jira edit" };
      const lastSyncedAt = 100;

      const res = ConflictResolver.reconcile(local, remote, lastSyncedAt, "theirs");
      expect(res.action).toBe("conflict");
      if (res.action === "conflict") {
        expect(res.resolvedPayload.title).toBe("Remote Jira edit");
      }
    });
  });

  describe("Sync Audit Logger (SHD-SYNC-013)", () => {
    it("writes immutable tamper-evident audit records", () => {
      const logger = new SyncAuditLogger(db);
      logger.log("jira", "create_issue", { key: "PROJ-1", summary: "Test issue" }, "success");
      logger.log("jira", "transition_issue", { key: "PROJ-1", to: "Done" }, "success");

      const entries = logger.list(10);
      expect(entries.length).toBe(2);
      expect(entries[0].destination).toBe("jira");
      expect(entries[0].payloadHash).toBeDefined();
      expect(entries[0].payloadHash.length).toBe(64); // SHA256 length
    });
  });
});
