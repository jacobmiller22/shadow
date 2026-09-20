import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["todo", "in_progress", "blocked", "done", "cancelled"] })
    .notNull()
    .default("todo"),
  priority: text("priority", { enum: ["critical", "high", "medium", "low"] })
    .notNull()
    .default("medium"),
  parentId: text("parent_id").references((): any => tasks.id, { onDelete: "set null" }),
  branch: text("branch"),
  metadata: text("metadata"), // JSON string
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  completedAt: integer("completed_at", { mode: "number" }),
});

export const taskRelations = sqliteTable("task_relations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: text("source_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  targetId: text("target_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  relationType: text("relation_type", { enum: ["blocks", "relates_to", "child_of"] }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const taskEvents = sqliteTable("task_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(), // JSON string
  timestamp: integer("timestamp", { mode: "number" }).notNull(),
});

export const syncQueue = sqliteTable("sync_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action", { enum: ["create", "update", "delete"] }).notNull(),
  payload: text("payload").notNull(), // JSON string
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  status: text("status", { enum: ["pending", "synced", "failed"] })
    .notNull()
    .default("pending"),
  error: text("error"),
});

export const idempotencyTokens = sqliteTable("idempotency_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  expiresAt: integer("expires_at", { mode: "number" }).notNull(),
});

export const workerClaims = sqliteTable("worker_claims", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id")
    .notNull()
    .unique()
    .references(() => tasks.id, { onDelete: "cascade" }),
  workerId: text("worker_id").notNull(),
  claimedAt: integer("claimed_at", { mode: "number" }).notNull(),
  leaseSeconds: integer("lease_seconds", { mode: "number" }).notNull(),
  expiresAt: integer("expires_at", { mode: "number" }).notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskRelation = typeof taskRelations.$inferSelect;
export type NewTaskRelation = typeof taskRelations.$inferInsert;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;
export type SyncQueueItem = typeof syncQueue.$inferSelect;
export type NewSyncQueueItem = typeof syncQueue.$inferInsert;
export type IdempotencyToken = typeof idempotencyTokens.$inferSelect;
export type NewIdempotencyToken = typeof idempotencyTokens.$inferInsert;
export type WorkerClaim = typeof workerClaims.$inferSelect;
export type NewWorkerClaim = typeof workerClaims.$inferInsert;
