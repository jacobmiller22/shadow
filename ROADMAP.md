# Shadow MVP Strategic Roadmap & Architecture Specification

**Document Version:** 1.0.0  
**Target Milestone:** Initial Minimum Viable Product (MVP)  
**Execution Lead:** Jacob Miller & Antigravity  
**Stack Alignment:** Local-First TypeScript/Bun CLI Engine + Cloudflare Edge Ecosystem (Workers, D1, Queues, Pages)  

---

## Executive Summary

This document establishes the end-to-end execution roadmap and low-level architectural specification for **Shadow**—a local-first developer project management system and enterprise sync bridge.

The design was hardened through **five rigorous expert iteration loops** across five core disciplines:
1. **Dr. Aris Thorne** — Principal Distributed Systems & Local-First Architect
2. **Kavita Patel** — Principal AI Agent & Tooling Architect
3. **Marcus Vance** — Cloudflare Edge & Serverless Architect
4. **Elena Rostova** — Principal Enterprise Systems & Jira Integration Specialist
5. **David Sterling** — Senior Staff Technical Program Manager & Delivery Lead

### Key Strategic Decisions:
- **Zero Daemon, CLI + Skills Protocol:** No background MCP server or complex IPC middleware. Agents operate via standardized `SKILL.md` instructions invoking the deterministic `shadow` CLI with structured `--json` output.
- **Unified TypeScript/Drizzle Architecture:** Shared data models, validation schemas (Zod), and business logic across both the **Local CLI** (running on embedded SQLite) and the **Cloudflare Edge** (running on Cloudflare D1). This achieves 100% schema parity and eliminates throwaway code.
- **The Cloudflare Edge Bridge:** Cloudflare Workers, D1, and Queues serve as an asynchronous edge relay for Jira OAuth 3LO token exchanges, Jira webhook ingestion, and cross-machine synchronization mailboxes, keeping the developer's local workstation isolated and private.
- **Phased Delivery (M0 - M4):** Every milestone is fully functional and delivers immediate developer utility without throwaway throw-ins.

---

## Section 1: The 5 Expert Iteration Loops

```
+-----------------------------------------------------------------------------------------+
|                                EXPERT REVIEW PANEL LOOPS                                |
+-----------------------------------------------------------------------------------------+
|  Loop 1: Architectural Topology (Edge-Assisted Local-First + Cloudflare Stack)         |
|  Loop 2: Data Models, Schema Harmonization (SQLite <-> D1) & N:M Mapping Mechanics      |
|  Loop 3: Developer & Agent Interfaces (Deterministic CLI & SKILL.md Protocol)           |
|  Loop 4: Milestone Staging, Delivery Phasing & Risk Mitigation                          |
|  Loop 5: Shovel-Ready Ticket Decomposition & Dependency Sequencing                      |
+-----------------------------------------------------------------------------------------+
```

---

### Loop 1: Architectural Topology & The Cloudflare Edge Role

#### 1.1 The Debate
* **Dr. Thorne (Local-First):** "Shadow must remain 100% functional with zero internet connectivity. If the developer is on an airplane or behind a restrictive corporate firewall, every task command (`add`, `start`, `done`, `comment`) must execute in under 15ms. The cloud must never be in the critical path of local work."
* **Marcus Vance (Cloudflare Edge):** "Agreed on local autonomy. But connecting a local CLI directly to Jira has severe pain points:
  1. **OAuth 2.0 3LO:** Jira requires an HTTPS redirect URI for OAuth. A local CLI cannot easily host a public HTTPS endpoint without tunnels like ngrok.
  2. **Jira Webhook Ingestion:** When teammates update Jira tickets, we need to capture those webhooks. Your laptop cannot accept inbound Jira webhooks when sleeping or behind NAT.
  3. **Multi-Machine Continuity:** Developers switch between desktops, laptops, and remote dev servers.
  Cloudflare Workers + D1 + Queues gives us a globally distributed, serverless Edge Bridge that acts as an OAuth broker, webhook aggregator, and sync mailbox."
* **Elena Rostova (Enterprise Jira):** "Jira Cloud REST API rate limits are aggressive (often throttled per tenant). If multiple agent subtasks hammer Jira directly from the client, the developer's IP will get blocked. The Cloudflare Edge layer can throttle and queue outbound requests using Cloudflare Queues."

#### 1.2 The Resolution & Architecture Decision Record (ADR-001)
* **Status:** Approved
* **Decision:** Implement a **Hybrid Edge-Assisted Local-First Architecture**.
  - **Local Core (Workstation):** Embedded SQLite with WAL mode. CLI compiles to a single standalone binary via Bun. All local CRUD operations execute locally against SQLite with 0ms network latency.
  - **Cloudflare Edge Bridge (`shadow-edge`):**
    - **Cloudflare Workers:** Edge API handling OAuth 3LO token dance with Atlassian, JWT session validation, and webhook dispatch.
    - **Cloudflare D1:** Edge SQLite database storing synced remote issue mirrors, mapping tables, and user sync mailboxes.
    - **Cloudflare Queues:** Buffers inbound Jira webhooks and outbound batch updates, smoothing rate limits.
    - **Cloudflare Pages / Workers Assets:** Hosts an optional, read-only developer dashboard for team stakeholders.
  - **Communication:** Local CLI connects to `shadow-edge` over authenticated HTTPS using an API key stored in the OS Keychain. Sync is strictly ad-hoc and on-demand (`shadow sync`).

```
+-----------------------------------------------------------------------------------+
|                           LOCAL DEVELOPER WORKSPACE (OFFLINE)                     |
|                                                                                   |
|   +-------------------+      +------------------------------------------+         |
|   | Human Developer   |      |  AI Coding Agents (Antigravity/Cursor)   |         |
|   +---------+---------+      +--------------------+---------------------+         |
|             |                                     |                               |
|             |                                     | Reads `SKILL.md`              |
|             v                                     v                               |
|   +-------------------------------------------------------------------+           |
|   |                        SHADOW CLI (Bun Binary)                    |           |
|   +---------------------------------+---------------------------------+           |
|                                     | Sub-10ms Reads/Writes                       |
|                                     v                                             |
|   +-------------------------------------------------------------------+           |
|   |                    LOCAL STORAGE (SQLite WAL)                     |           |
|   |   - tasks, epics, spikes, events, mappings, offline_queue         |           |
|   +---------------------------------+---------------------------------+           |
+-------------------------------------|---------------------------------------------+
                                      |
                                      | Ad-hoc Push/Pull (`shadow sync`)
                                      | Authenticated TLS / Bearer Token
                                      v
+-----------------------------------------------------------------------------------+
|                        CLOUDFLARE EDGE BRIDGE (`shadow-edge`)                     |
|                                                                                   |
|   +---------------------------------------------------------------------------+   |
|   | Cloudflare Workers (OAuth 3LO Broker, Webhook Ingestion, Auth Gateway)    |   |
|   +-----------------------+-----------------------------+---------------------+   |
|                           |                             |                         |
|                           v                             v                         v
|   +-------------------------------+   +-----------------------------+   +---------+
|   | Cloudflare D1 (Edge SQLite)   |   | Cloudflare Queues           |   | Pages UI|
|   | - Remote Issue Mirror Cache   |   | - Webhook Ingestion Buffer  |   | (Viewer)|
|   | - Mapping Registry            |   | - Rate-limited Sync Worker  |   +---------+
|   +-------------------------------+   +--------------+--------------+             |
+------------------------------------------------------|----------------------------+
                                                       |
                                                       | Filtered & Sanitized API
                                                       v
+-----------------------------------------------------------------------------------+
|                           ENTERPRISE JIRA CLOUD (REMOTE)                          |
+-----------------------------------------------------------------------------------+
```

---

### Loop 2: Data Models, Schema Harmonization & $N \leftrightarrow M$ Mapping Mechanics

#### 2.1 The Debate
* **Elena Rostova (Enterprise Jira):** "In Jira, an Epic contains Stories, and Stories have Subtasks. But developers don't work in rigid 3-level hierarchies. They have spikes, investigative threads, subagent checklists, and cross-cutting refactors. How do we model $N \leftrightarrow M$ without creating an incomprehensible graph?"
* **Dr. Thorne (Distributed Systems):** "Every entity in Shadow should be a polymorphic `TaskNode` with a recursive `parent_id`, a `type` (`epic`, `story`, `task`, `spike`, `subtask`), and a directed DAG edge table for non-hierarchical relationships (`blocks`, `relates_to`). For the mapping table, we decouple local IDs from remote keys via an explicit join table: `remote_mappings`."
* **Marcus Vance (Cloudflare Edge):** "Because both local storage (SQLite) and Cloudflare Edge (D1) use the SQLite SQL dialect, we can use **Drizzle ORM** with TypeScript. We write our schema definitions once. The exact same migration scripts and query builders execute locally and at the edge."

#### 2.2 The Resolution & Schema Specification
* **Status:** Approved
* **Decision:** Implement single-source-of-truth TypeScript schemas via Drizzle ORM.

```typescript
// Core Local & Edge Schema (Drizzle SQLite / D1 compatible)

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), // e.g., 'SHD-101' or ULID
  projectId: text('project_id').notNull(),
  parentId: text('parent_id'), // Self-referencing recursive hierarchy
  title: text('title').notNull(),
  description: text('description').default(''),
  type: text('type', { enum: ['epic', 'story', 'task', 'spike', 'subtask'] }).notNull().default('task'),
  status: text('status', { enum: ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'] }).notNull().default('todo'),
  priority: integer('priority').notNull().default(3), // 1 (highest) - 5 (lowest)
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false), // Firewall flag
  gitBranch: text('git_branch'),
  gitWorktree: text('git_worktree'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const remoteMappings = sqliteTable('remote_mappings', {
  id: text('id').primaryKey(),
  localTaskId: text('local_task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  remoteSystem: text('remote_system').notNull(), // 'jira', 'linear', 'github'
  remoteKey: text('remote_key').notNull(), // e.g., 'PROJ-1042'
  relationType: text('relation_type', { enum: ['tracks', 'subtask_of', 'blocks', 'relates_to'] }).notNull().default('tracks'),
  rollupPolicy: text('rollup_policy', { mode: 'json' }).$type<{
    strategy: 'checklist_comment' | 'status_only' | 'description_checklist';
    format?: string;
  }>(),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  lastSyncedHash: text('last_synced_hash'),
});

export const syncQueue = sqliteTable('sync_queue', {
  id: text('id').primaryKey(),
  localTaskId: text('local_task_id'),
  operation: text('operation', { enum: ['push_task', 'push_comment', 'transition', 'link'] }).notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

---

### Loop 3: Developer & Agent Interfaces (Deterministic CLI & `SKILL.md`)

#### 3.1 The Debate
* **Kavita Patel (AI Agent Architect):** "Agents don't parse ANSI terminal colors or interactive prompts. When an agent runs `shadow task list`, it needs deterministic JSON on `stdout`. If a command fails, `stderr` must contain a structured JSON error object with a numeric error code, and the process must exit with a non-zero exit code."
* **David Sterling (TPM / Delivery Lead):** "Human developers still need an enjoyable CLI experience: colorful tables, interactive pickers, and quick aliases. How do we serve both without maintaining two separate binaries?"
* **Kavita Patel:** "Auto-detection plus explicit flags. If `stdout` is a TTY and no `--json` flag is provided, render human-friendly interactive tables. If `!isatty(stdout)` or `--json` is specified, emit raw, machine-readable JSON. Furthermore, every state-modifying command must accept `--non-interactive` or `-y` to guarantee an agent is never blocked on a confirmation prompt."
* **Dr. Thorne:** "What about large inputs? Passing large markdown task specifications via bash flags can hit argument length limits or escaping issues. The CLI must support reading from `stdin` (`shadow task add --body -`) or from a file (`--body-file <path>`)."

#### 3.2 The Resolution & Interface Standards
* **Status:** Approved
* **Decision:**
  - Standardized CLI syntax: `shadow <domain> <action> [args] [flags]`.
  - Machine contracts: `--json`, `--quiet`, `--non-interactive`, `--body-file`, `--stdin`.
  - Exit Codes: `0` = Success, `1` = General Error, `2` = Validation Error, `3` = Conflict Detected, `4` = Network/Auth Error (queued locally).
  - Agent Skill Protocol (`SKILL.md`): Ships directly in the repository and global agent paths (`~/.gemini/config/skills/shadow/SKILL.md` and `.claude/plugins`).

---

### Loop 4: Milestone Staging & Delivery Phasing (No Throwaway Work)

#### 4.1 The Debate
* **David Sterling (TPM):** "We cannot afford throwaway code. If we build a throwaway mock sync layer in Phase 1 that we rewrite in Phase 3, we fail. Every milestone must be additive and production-grade."
* **Marcus Vance (Cloudflare):** "We shouldn't delay local developer value while setting up Cloudflare Workers. Milestone 0 and 1 must give the developer a functioning, world-class local task engine. Then Milestone 2 introduces the Cloudflare Edge Bridge. Milestone 3 wires the $N \leftrightarrow M$ sync engine between the local DB and the Edge."
* **Elena Rostova (Enterprise Jira):** "Jira ADF (Atlassian Document Format) is notoriously tricky. Building an ADF converter from scratch can take weeks. We should isolate the Markdown $\leftrightarrow$ ADF transformer in Milestone 3 as a pure functional module with comprehensive unit tests."

#### 4.2 The Resolution: 5 Phased Milestones (M0 - M4)

```
+-----------------------------------------------------------------------------------------+
|                                    DELIVERY MILESTONES                                  |
+-----------------------------------------------------------------------------------------+

  [M0: Local Storage Engine & CLI Foundation] (Foundation)
  - Embedded SQLite database with Drizzle ORM & WAL mode.
  - Core CLI binary compiled via Bun (`shadow task add`, `list`, `edit`, `done`, `status`).
  - Strict human vs `--json` agent output modes. Git context binding (branch/commit).

  [M1: Agent Skill Protocol & Context Engine] (Agent-Native)
  - Production `SKILL.md` with proactive triggers (session start, task pivot, dual verification).
  - Scratchpad drafting flow, subagent concurrency test harness.
  - Active task context injection (`shadow context --format prompt`).

  [M2: Cloudflare Edge Bridge] (Cloud Infrastructure)
  - Cloudflare Worker API (`shadow-edge`) with Wrangler configuration.
  - Cloudflare D1 database initialized with synchronized schema.
  - Cloudflare Queues for webhook buffering. Atlassian OAuth 3LO broker.

  [M3: N <-> M Mapping, Rollup & Jira Connector] (Core Differentiator)
  - Arbitrary N:M relational mapping engine.
  - Rollup summarizer (Markdown & ADF comment generator, checklist updater).
  - Privacy & Sanitization Firewall (redaction engine).
  - Ad-hoc bi-directional sync (`shadow sync push/pull`) with offline fallback.

  [M4: Developer TUI & Cloudflare Edge Web Dashboard] (Polish & Visibility)
  - Terminal User Interface (TUI) interactive dashboard for fast keyboard navigation.
  - Cloudflare Pages / Workers read-only web viewer for stakeholders.
  - Complete documentation and installer scripts.
```

---

### Loop 5: Hardening the Ticket Decomposition & Execution Plan

#### 5.1 The Review
* **David Sterling (TPM):** "To make this shovel-ready, every ticket must have clear technical bounds, explicit acceptance criteria, and zero ambiguity about dependencies. No ticket should exceed 2-3 engineering days."
* **All Experts:** Reviewed and approved the 25 granular engineering specifications in Section 3 of this document.

---

## Section 2: Architectural Blueprints & Technical Specifications

### 2.1 The Local CLI Core
- **Runtime & Compilation:** TypeScript executed and compiled into a single static binary using **Bun** (`bun build --compile --minify --target=bun-darwin-arm64 ./src/cli.ts --outfile shadow`).
- **Database Engine:** Embedded SQLite via `better-sqlite3` or Bun's native `bun:sqlite` with:
  ```sql
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  ```
- **Performance Budget:**
  - Cold startup to `--json` output: $< 25\text{ms}$.
  - Write transaction latency: $< 15\text{ms}$.
  - Full-text search across 5,000 tasks: $< 10\text{ms}$.

### 2.2 The Cloudflare Edge Bridge (`shadow-edge`)
- **Wrangler Configuration:** Managed under `edge/wrangler.toml`.
- **Bindings:**
  - `D1Database`: `SHADOW_EDGE_D1` (Mirror DB and sync registry)
  - `Queue`: `JIRA_WEBHOOK_QUEUE` (Ingestion queue)
  - `KVNamespace`: `SHADOW_KV_SESSIONS` (Temporary OAuth tokens and nonce store)
- **Security:**
  - Local CLI authenticates to Worker using Ed25519 signed headers or high-entropy Bearer API tokens generated during `shadow auth login`.
  - Zero plaintext secrets stored in git; production credentials stored in Cloudflare Secrets and developer credentials in OS Keychain (`keytar` or `security-cli`).

### 2.3 The Privacy & Sanitization Firewall
Before any local payload leaves the machine:
```typescript
export interface SanitizationRules {
  stripFields: string[]; // e.g. ['notes', 'debug_logs', 'scratchpad']
  redactPatterns: RegExp[]; // API keys, emails, internal corporate domains
  maskFilePaths: boolean; // Replaces /Users/jacob/... with ~/...
  requireConfirmation: boolean;
}
```

---

## Section 3: Detailed Milestone Delivery Plan

```
+-----------------------------------------------------------------------------------------+
|                                    MILESTONE MATRIX                                     |
+--------------------+-------------------------------------------+------------------------+
| Milestone          | Primary Focus                             | Key Deliverable        |
+--------------------+-------------------------------------------+------------------------+
| **Milestone 0**    | Local Storage & Core CLI                  | `shadow` standalone    |
| **Milestone 1**    | Agent Skill & Concurrency                 | `SKILL.md` & Harness   |
| **Milestone 2**    | Cloudflare Edge Relay (D1/Workers/Queues) | `shadow-edge` API      |
| **Milestone 3**    | $N \leftrightarrow M$ Engine & Jira Sync  | Full Bi-directional    |
| **Milestone 4**    | Developer TUI & Cloudflare Dashboard      | TUI & Web Projection   |
+--------------------+-------------------------------------------+------------------------+
```

---

## Section 4: Shovel-Ready Ticket Breakdown (Summary)

The complete implementation comprises **25 granular, shovel-ready tickets** across the five milestones:

- **Milestone 0: Core Local Foundation & SQLite Engine**
  - `SHD-CORE-001`: Workspace Scaffolding & Bun/TypeScript Monorepo Setup
  - `SHD-CORE-002`: SQLite Schema, Drizzle ORM & Migration Subsystem
  - `SHD-CORE-003`: Local Task Engine & Hierarchy Management
  - `SHD-CORE-004`: Unified CLI Framework & Dual-Mode Formatter (Human & `--json`)
  - `SHD-CORE-005`: Git Branch & Worktree (`wt`) Context Integration

- **Milestone 1: Agent Skill Protocol & Context Engine**
  - `SHD-SKILL-001`: Standardized Agent Skill Specification (`SKILL.md`)
  - `SHD-SKILL-002`: Agent Lifecycle Hooks & Proactive Trigger Definitions
  - `SHD-SKILL-003`: Dual-Verification Gatekeeper & Closure Protocols
  - `SHD-SKILL-004`: Subagent Multi-Process Concurrency & SQLite WAL Stress Harness
  - `SHD-SKILL-005`: Prompt Context Injection Subcommand (`shadow context`)

- **Milestone 2: Cloudflare Edge Bridge (`shadow-edge`)**
  - `SHD-CF-001`: Cloudflare Worker API & Wrangler Environment Setup
  - `SHD-CF-002`: Cloudflare D1 Edge Schema & Shared Drizzle Parity
  - `SHD-CF-003`: Atlassian Jira OAuth 2.0 3LO Broker on Workers
  - `SHD-CF-004`: Cloudflare Queues Jira Webhook Receiver & Buffer
  - `SHD-CF-005`: Local CLI Auth Dance & OS Keychain Credential Store

- **Milestone 3: $N \leftrightarrow M$ Mapping, Rollup & Jira Sync Engine**
  - `SHD-SYNC-001`: The $N \leftrightarrow M$ Relational Mapping Engine
  - `SHD-SYNC-002`: Rollup Synthesis & ADF (Atlassian Document Format) Generator
  - `SHD-SYNC-003`: Privacy & Sanitization Firewall
  - `SHD-SYNC-004`: Jira REST API v3 Client & Rate-Limited Transport
  - `SHD-SYNC-005`: Offline Mutation Queue & Background Reconciliation Engine

- **Milestone 4: Developer TUI & Cloudflare Edge Dashboard**
  - `SHD-TUI-001`: Interactive Terminal Dashboard (TUI)
  - `SHD-TUI-002`: Git Hook Auto-Sync Integrations (`pre-push`, `post-commit`)
  - `SHD-WEB-001`: Cloudflare Pages Read-Only Stakeholder Viewer
  - `SHD-DOCS-001`: Developer Onboarding, Architecture Docs & CLI Reference
  - `SHD-QA-001`: End-to-End Simulation & Verification Test Suite

*(See `TICKETS.md` for complete technical specifications, acceptance criteria, and dependency graphs for each ticket).*

---

*End of Strategic Roadmap.*
