import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { FTSSearchEngine, type FTSMatchResult } from "../db/fts";
import { GitContextResolver } from "../git/context";
import { SQLiteConnectionFactory } from "../db/connection";
import { IdempotencyEngine } from "./idempotency.service";
import { ChecklistService, type ChecklistReport } from "./checklist.service";
import { VerificationService, type VerificationResult } from "./verify.service";
import { DecompositionTemplateService } from "./template.service";
import { WorkerClaimService } from "./claim.service";

export class CycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleError";
  }
}

export class UncompletedChecklistError extends Error {
  public report: ChecklistReport;

  constructor(taskId: string, report: ChecklistReport) {
    super(
      `Cannot close task ${taskId}: ${report.remaining} unchecked checklist item(s) remain. Use --force to override.`
    );
    this.name = "UncompletedChecklistError";
    this.report = report;
  }
}

export class VerificationFailedError extends Error {
  public result: VerificationResult;

  constructor(taskId: string, result: VerificationResult) {
    super(
      `Verification command failed for task ${taskId} (exit code ${result.exitCode}):\n${result.stderr || result.stdout}`
    );
    this.name = "VerificationFailedError";
    this.result = result;
  }
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  priority?: "critical" | "high" | "medium" | "low";
  parentId?: string;
  branch?: string;
  workspaceId?: string;
  metadata?: Record<string, any>;
  customId?: string;
  idempotencyKey?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  priority?: "critical" | "high" | "medium" | "low";
  parentId?: string | null;
  branch?: string;
  metadata?: Record<string, any>;
}

export interface CloseTaskOptions {
  force?: boolean;
  verifyCmd?: string;
}

export interface ListTasksFilter {
  workspaceId?: string;
  allWorkspaces?: boolean;
  status?: string;
  priority?: string;
  parentId?: string | null;
  limit?: number;
  offset?: number;
}

export interface TaskTreeNode extends schema.Task {
  children: TaskTreeNode[];
  blockedBy?: string[];
  blocks?: string[];
}

export class TaskService {
  private db: Database;
  private orm: ReturnType<typeof drizzle<typeof schema>>;
  private idempotency: IdempotencyEngine;
  private claims: WorkerClaimService;

  constructor(db: Database) {
    this.db = db;
    this.orm = drizzle(db, { schema });
    this.idempotency = new IdempotencyEngine(db);
    this.claims = new WorkerClaimService(db);
  }

  public getClaimsService(): WorkerClaimService {
    return this.claims;
  }

  /**
   * Generates a unique task ID. Checks max existing ID number or uses random suffix.
   */
  public generateTaskId(): string {
    const res = this.db.query("SELECT id FROM tasks ORDER BY rowid DESC LIMIT 1;").get() as any;
    if (res && typeof res.id === "string" && res.id.startsWith("SHD-")) {
      const numPart = parseInt(res.id.replace("SHD-", ""), 10);
      if (!isNaN(numPart)) {
        return `SHD-${String(numPart + 1).padStart(4, "0")}`;
      }
    }
    const countRes = this.db.query("SELECT count(*) as count FROM tasks;").get() as any;
    const count = (countRes?.count ?? 0) + 1;
    return `SHD-${String(count).padStart(4, "0")}`;
  }

  /**
   * Validates that assigning targetParentId as parent of taskId does not introduce a cycle.
   */
  public validateNoParentCycle(taskId: string, targetParentId: string): void {
    if (taskId === targetParentId) {
      throw new CycleError(`Cycle detected: Task ${taskId} cannot be its own parent.`);
    }

    let currentId: string | null = targetParentId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) {
        throw new CycleError(`Cycle detected: Loop exists in ancestor chain at ${currentId}.`);
      }
      visited.add(currentId);

      if (currentId === taskId) {
        throw new CycleError(
          `Cycle detected: Task ${taskId} is an ancestor of task ${targetParentId}.`
        );
      }

      const parentTask = this.getTask(currentId);
      currentId = parentTask ? parentTask.parentId : null;
    }
  }

  /**
   * Validates that adding a dependency (source blocks target) does not introduce a dependency cycle.
   */
  public validateNoDependencyCycle(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      throw new CycleError(`Cycle detected: Task ${sourceId} cannot block itself.`);
    }

    const visited = new Set<string>();
    const stack = [targetId];

    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (curr === sourceId) {
        throw new CycleError(`Cycle detected: Task ${targetId} already directly or indirectly blocks ${sourceId}.`);
      }
      if (!visited.has(curr)) {
        visited.add(curr);
        const downstream = this.db.query(
          "SELECT target_id FROM task_relations WHERE source_id = ? AND relation_type = 'blocks';"
        ).all(curr) as { target_id: string }[];
        for (const rel of downstream) {
          stack.push(rel.target_id);
        }
      }
    }
  }

  /**
   * Creates a new task with idempotency protection against duplicate agent retries.
   */
  public createTask(input: CreateTaskInput): schema.Task & { isDeduplicated?: boolean } {
    const gitContext = GitContextResolver.resolve();
    const workspaceId = input.workspaceId || gitContext.workspaceId;
    const branch = input.branch || (gitContext.isGitRepo ? gitContext.currentBranch : undefined);

    // 1. Check idempotency deduplication
    const token = IdempotencyEngine.generateToken(
      workspaceId,
      input.title,
      input.parentId,
      input.idempotencyKey
    );
    const existing = this.idempotency.findExisting(token);
    if (existing) {
      return { ...existing, isDeduplicated: true };
    }

    const id = input.customId || this.generateTaskId();
    const now = Date.now();

    if (input.parentId) {
      const parent = this.getTask(input.parentId);
      if (!parent) {
        throw new Error(`Parent task not found: ${input.parentId}`);
      }
      this.validateNoParentCycle(id, input.parentId);
    }

    const newTask: schema.NewTask = {
      id,
      workspaceId,
      title: input.title,
      description: input.description || null,
      status: input.status || "todo",
      priority: input.priority || "medium",
      parentId: input.parentId || null,
      branch: branch || null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
      updatedAt: now,
      completedAt: input.status === "done" ? now : null,
    };

    SQLiteConnectionFactory.withRetry(() => {
      this.orm.insert(schema.tasks).values(newTask).run();

      // Register idempotency token
      this.idempotency.register(token, id);

      // Record event
      this.orm.insert(schema.taskEvents).values({
        taskId: id,
        eventType: "created",
        payload: JSON.stringify(newTask),
        timestamp: now,
      }).run();

      // Enqueue sync mutation
      this.orm.insert(schema.syncQueue).values({
        entityType: "task",
        entityId: id,
        action: "create",
        payload: JSON.stringify(newTask),
        createdAt: now,
        status: "pending",
      }).run();
    });

    return { ...this.getTask(id)!, isDeduplicated: false };
  }

  /**
   * Retrieves a task by ID.
   */
  public getTask(id: string): schema.Task | null {
    const result = this.orm.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    return result || null;
  }

  /**
   * Retrieves the currently active in-progress task for the current workspace/branch.
   */
  public getActiveTask(branch?: string, workspaceId?: string): schema.Task | null {
    const gitContext = GitContextResolver.resolve();
    const effectiveWorkspace = workspaceId || gitContext.workspaceId;
    const effectiveBranch = branch || gitContext.currentBranch;

    // First try: in_progress on active branch
    let row = this.db
      .query(
        `SELECT * FROM tasks
         WHERE workspace_id = ? AND branch = ? AND status = 'in_progress'
         ORDER BY updated_at DESC LIMIT 1;`
      )
      .get(effectiveWorkspace, effectiveBranch) as any;

    if (!row) {
      // Second try: any in_progress task in the workspace
      row = this.db
        .query(
          `SELECT * FROM tasks
           WHERE workspace_id = ? AND status = 'in_progress'
           ORDER BY updated_at DESC LIMIT 1;`
        )
        .get(effectiveWorkspace) as any;
    }

    if (!row) return null;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      parentId: row.parent_id,
      branch: row.branch,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  /**
   * Updates an existing task and verifies hierarchy cycle constraints.
   */
  public updateTask(id: string, input: UpdateTaskInput): schema.Task {
    const task = this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (input.parentId !== undefined && input.parentId !== null) {
      this.validateNoParentCycle(id, input.parentId);
    }

    const now = Date.now();
    const updateValues: Partial<schema.NewTask> = {
      updatedAt: now,
    };

    if (input.title !== undefined) updateValues.title = input.title;
    if (input.description !== undefined) updateValues.description = input.description;
    if (input.status !== undefined) {
      updateValues.status = input.status;
      if (input.status === "done" && !task.completedAt) {
        updateValues.completedAt = now;
      } else if (input.status !== "done") {
        updateValues.completedAt = null;
      }
    }
    if (input.priority !== undefined) updateValues.priority = input.priority;
    if (input.parentId !== undefined) updateValues.parentId = input.parentId;
    if (input.branch !== undefined) updateValues.branch = input.branch;
    if (input.metadata !== undefined) {
      updateValues.metadata = JSON.stringify(input.metadata);
    }

    SQLiteConnectionFactory.withRetry(() => {
      this.orm.update(schema.tasks).set(updateValues).where(eq(schema.tasks.id, id)).run();

      this.orm.insert(schema.taskEvents).values({
        taskId: id,
        eventType: "updated",
        payload: JSON.stringify(updateValues),
        timestamp: now,
      }).run();

      this.orm.insert(schema.syncQueue).values({
        entityType: "task",
        entityId: id,
        action: "update",
        payload: JSON.stringify(updateValues),
        createdAt: now,
        status: "pending",
      }).run();
    });

    return this.getTask(id)!;
  }

  /**
   * Closes a task with checklist validation and optional verification command execution.
   */
  public closeTask(id: string, options: CloseTaskOptions = {}): schema.Task {
    const task = this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    // 1. Checklist completion guard (SHD-SKILL-007)
    if (!options.force && task.description) {
      const report = ChecklistService.parse(task.description);
      if (!report.allCompleted) {
        throw new UncompletedChecklistError(id, report);
      }
    }

    // 2. Verification command probe (SHD-SKILL-006)
    if (options.verifyCmd) {
      const verifyResult = VerificationService.execute(options.verifyCmd);
      const now = Date.now();

      if (!verifyResult.success) {
        // Log verification failure
        SQLiteConnectionFactory.withRetry(() => {
          this.orm.insert(schema.taskEvents).values({
            taskId: id,
            eventType: "verification_failed",
            payload: JSON.stringify(verifyResult),
            timestamp: now,
          }).run();
        });
        throw new VerificationFailedError(id, verifyResult);
      }

      // Log verification success
      SQLiteConnectionFactory.withRetry(() => {
        this.orm.insert(schema.taskEvents).values({
          taskId: id,
          eventType: "verified",
          payload: JSON.stringify(verifyResult),
          timestamp: now,
        }).run();
      });
    }

    // 3. Complete task
    return this.updateTask(id, { status: "done" });
  }

  /**
   * Context pivot: pauses the active task and transitions another task to in_progress.
   */
  public pivotTask(newTaskId: string): { previous: schema.Task | null; active: schema.Task } {
    const target = this.getTask(newTaskId);
    if (!target) {
      throw new Error(`Target task for pivot not found: ${newTaskId}`);
    }

    const gitContext = GitContextResolver.resolve();
    const effectiveBranch = target.branch || (gitContext.isGitRepo ? gitContext.currentBranch : "main");
    const currentActive = this.getActiveTask(effectiveBranch, target.workspaceId);

    const now = Date.now();
    let prevUpdated: schema.Task | null = null;

    if (currentActive && currentActive.id !== newTaskId) {
      // Record checkpoint on previous task
      this.addComment(currentActive.id, `⏸️ Paused task context for pivot to ${newTaskId}`);
      prevUpdated = this.updateTask(currentActive.id, { status: "todo" });
    }

    // Activate new task
    this.addComment(newTaskId, `▶️ Pivoted task context to active on branch '${effectiveBranch}'`);
    const activeUpdated = this.updateTask(newTaskId, {
      status: "in_progress",
      branch: effectiveBranch,
    });

    return { previous: prevUpdated, active: activeUpdated };
  }

  /**
   * Appends an audit comment or progress note to task_events.
   */
  public addComment(id: string, message: string): void {
    const task = this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    const now = Date.now();
    SQLiteConnectionFactory.withRetry(() => {
      this.orm.insert(schema.taskEvents).values({
        taskId: id,
        eventType: "comment",
        payload: JSON.stringify({ message }),
        timestamp: now,
      }).run();

      this.orm.update(schema.tasks).set({ updatedAt: now }).where(eq(schema.tasks.id, id)).run();
    });
  }

  /**
   * Retrieves event history for a task.
   */
  public getTaskHistory(id: string): schema.TaskEvent[] {
    const rows = this.db
      .query(`SELECT * FROM task_events WHERE task_id = ? ORDER BY timestamp ASC;`)
      .all(id) as any[];

    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      eventType: r.event_type,
      payload: r.payload,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Decomposes a parent task using a predefined template (SHD-SKILL-013).
   */
  public decomposeTask(parentId: string, templateName: string): schema.Task[] {
    const parent = this.getTask(parentId);
    if (!parent) {
      throw new Error(`Parent task not found: ${parentId}`);
    }

    const template = DecompositionTemplateService.getTemplate(templateName);
    if (!template) {
      throw new Error(`Unknown template '${templateName}'. Available: feature, bugfix, refactor, research`);
    }

    const created: schema.Task[] = [];
    for (const sub of template.subtasks) {
      const child = this.createTask({
        title: `${parent.title}: ${sub.titleSuffix}`,
        description: sub.description,
        priority: sub.priority,
        parentId: parent.id,
        status: "todo",
      });
      created.push(child);
    }

    this.addComment(
      parentId,
      `Decomposed into ${created.length} subtasks using template '${template.name}'`
    );

    return created;
  }

  /**
   * Deletes a task by ID.
   */
  public deleteTask(id: string): boolean {
    const task = this.getTask(id);
    if (!task) return false;

    const now = Date.now();
    SQLiteConnectionFactory.withRetry(() => {
      this.orm.delete(schema.tasks).where(eq(schema.tasks.id, id)).run();

      this.orm.insert(schema.syncQueue).values({
        entityType: "task",
        entityId: id,
        action: "delete",
        payload: JSON.stringify({ id }),
        createdAt: now,
        status: "pending",
      }).run();
    });

    return true;
  }

  /**
   * Lists tasks with optional workspace and status filters.
   */
  public listTasks(filter: ListTasksFilter = {}): schema.Task[] {
    const gitContext = GitContextResolver.resolve();
    const effectiveWorkspace = filter.allWorkspaces
      ? undefined
      : filter.workspaceId || gitContext.workspaceId;

    let query = "SELECT * FROM tasks WHERE 1=1";
    const params: any[] = [];

    if (effectiveWorkspace) {
      query += " AND workspace_id = ?";
      params.push(effectiveWorkspace);
    }
    if (filter.status) {
      query += " AND status = ?";
      params.push(filter.status);
    }
    if (filter.priority) {
      query += " AND priority = ?";
      params.push(filter.priority);
    }
    if (filter.parentId !== undefined) {
      if (filter.parentId === null) {
        query += " AND parent_id IS NULL";
      } else {
        query += " AND parent_id = ?";
        params.push(filter.parentId);
      }
    }

    query += " ORDER BY created_at ASC";

    if (filter.limit) {
      query += " LIMIT ?";
      params.push(filter.limit);
      if (filter.offset) {
        query += " OFFSET ?";
        params.push(filter.offset);
      }
    }

    const stmt = this.db.query(query);
    const rows = stmt.all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      parentId: r.parent_id,
      branch: r.branch,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
    }));
  }

  /**
   * Adds a relation between two tasks.
   */
  public addRelation(
    sourceId: string,
    targetId: string,
    relationType: "blocks" | "relates_to" | "child_of"
  ): schema.TaskRelation {
    const source = this.getTask(sourceId);
    const target = this.getTask(targetId);
    if (!source || !target) {
      throw new Error(`Tasks not found for relation: ${sourceId} -> ${targetId}`);
    }

    if (relationType === "blocks") {
      this.validateNoDependencyCycle(sourceId, targetId);
    }

    const now = Date.now();
    SQLiteConnectionFactory.withRetry(() => {
      this.orm.insert(schema.taskRelations).values({
        sourceId,
        targetId,
        relationType,
        createdAt: now,
      }).run();
    });

    const res = this.db.query(
      "SELECT * FROM task_relations WHERE source_id = ? AND target_id = ? AND relation_type = ? ORDER BY id DESC LIMIT 1;"
    ).get(sourceId, targetId, relationType) as any;

    return {
      id: res.id,
      sourceId: res.source_id,
      targetId: res.target_id,
      relationType: res.relation_type,
      createdAt: res.created_at,
    };
  }

  /**
   * Builds a recursive task tree.
   */
  public getTaskTree(rootTaskId?: string, filter: ListTasksFilter = {}): TaskTreeNode[] {
    const allTasks = this.listTasks(filter);
    const taskMap = new Map<string, TaskTreeNode>();

    for (const t of allTasks) {
      taskMap.set(t.id, { ...t, children: [] });
    }

    const roots: TaskTreeNode[] = [];
    for (const t of allTasks) {
      const node = taskMap.get(t.id)!;
      if (t.parentId && taskMap.has(t.parentId)) {
        taskMap.get(t.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    if (rootTaskId) {
      const selected = taskMap.get(rootTaskId);
      return selected ? [selected] : [];
    }

    return roots;
  }

  /**
   * Full-text searches tasks across titles and descriptions using FTS5.
   */
  public searchTasks(query: string, limit: number = 20): FTSMatchResult[] {
    return FTSSearchEngine.search(this.db, query, limit);
  }
}
