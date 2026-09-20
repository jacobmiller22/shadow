import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { FTSSearchEngine, type FTSMatchResult } from "../db/fts";
import { GitContextResolver } from "../git/context";
import { SQLiteConnectionFactory } from "../db/connection";

export class CycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleError";
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

  constructor(db: Database) {
    this.db = db;
    this.orm = drizzle(db, { schema });
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
    // Fallback if non-sequential
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

    // Traverse upwards from targetParentId to root. If taskId is encountered, it is a cycle.
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

    // DFS from targetId to see if we can reach sourceId through 'blocks' relations
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
   * Creates a new task and emits creation events.
   */
  public createTask(input: CreateTaskInput): schema.Task {
    const gitContext = GitContextResolver.resolve();
    const workspaceId = input.workspaceId || gitContext.workspaceId;
    const branch = input.branch || (gitContext.isGitRepo ? gitContext.currentBranch : undefined);
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

    return this.getTask(id)!;
  }

  /**
   * Retrieves a task by ID.
   */
  public getTask(id: string): schema.Task | null {
    const result = this.orm.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    return result || null;
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

      // Record event
      this.orm.insert(schema.taskEvents).values({
        taskId: id,
        eventType: "updated",
        payload: JSON.stringify(updateValues),
        timestamp: now,
      }).run();

      // Enqueue sync mutation
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

    // Map rows to schema.Task format
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
   * Adds a relation between two tasks (e.g. blocks, relates_to, child_of).
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
   * Builds a recursive task tree for a parent task or the entire workspace.
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
