# Shadow MVP Low-Level Engineering Ticket Breakdown

**Document Version:** 1.0.0  
**Associated Roadmap:** [ROADMAP.md](file:///Users/jacobmiller22/projects/shadow.feature-3-mvp-roadmap/ROADMAP.md)  
**Total Tickets:** 25 Shovel-Ready Engineering Specifications  
**Milestone Distribution:** M0 (5), M1 (5), M2 (5), M3 (5), M4 (5)  

---

## Milestone 0: Core Local Foundation & SQLite Engine

```
+-----------------------------------------------------------------------------------------+
|                        MILESTONE 0: LOCAL STORAGE & CORE CLI                            |
+-------------------+----------------------------------------------------+----------------+
| Ticket ID         | Title                                              | Estimate       |
+-------------------+----------------------------------------------------+----------------+
| `SHD-CORE-001`    | Workspace Monorepo Scaffolding & Bun Toolchain    | 2 pts (Small)  |
| `SHD-CORE-002`    | SQLite Database, Drizzle ORM & Migrations Subsystem| 3 pts (Medium) |
| `SHD-CORE-003`    | Local Task Engine & Hierarchy Management           | 5 pts (Large)  |
| `SHD-CORE-004`    | Unified CLI Framework & Dual-Mode Formatter        | 5 pts (Large)  |
| `SHD-CORE-005`    | Git Branch & Worktree (`wt`) Context Integration   | 3 pts (Medium) |
+-------------------+----------------------------------------------------+----------------+
```

---

### `SHD-CORE-001`: Workspace Monorepo Scaffolding & Bun Toolchain
- **Milestone:** M0 (Core Local Foundation)
- **Component:** Core Toolchain / Build System
- **Dependencies:** None
- **Estimate:** 2 pts
- **Objective:** Establish the monorepo structure supporting shared TypeScript models between the local CLI and the Cloudflare Worker edge bridge, with fast single-binary compilation via Bun.
- **Technical Requirements:**
  1. Initialize Bun workspace with packages:
     - `packages/shared`: Shared TypeScript types, Zod schemas, and Drizzle ORM table definitions.
     - `packages/cli`: Local CLI application (`shadow`).
     - `packages/edge`: Cloudflare Workers application (`shadow-edge`).
  2. Setup `tsconfig.json` with strict type checking, `paths` alias for `@shadow/shared`.
  3. Create build script in `packages/cli` using `bun build --compile --minify` targeting standalone native binaries for macOS (`darwin-arm64`, `darwin-x64`) and Linux (`linux-x64`).
  4. Configure Vitest test runner for sub-second unit testing.
- **Acceptance Criteria:**
  - [ ] Running `bun run build` in `packages/cli` outputs a standalone executable binary named `shadow`.
  - [ ] Executing `./shadow --version` completes in $< 20\text{ms}$ and prints semantic version.
  - [ ] Running `bun test` passes across all monorepo packages.

---

### `SHD-CORE-002`: SQLite Database, Drizzle ORM & Migrations Subsystem
- **Milestone:** M0 (Core Local Foundation)
- **Component:** Local Persistence Layer
- **Dependencies:** `SHD-CORE-001`
- **Estimate:** 3 pts
- **Objective:** Implement the embedded SQLite storage engine using Drizzle ORM with automatic schema migrations, WAL mode, and sub-10ms transactional writes.
- **Technical Requirements:**
  1. Initialize SQLite database at `~/.local/share/shadow/shadow.db` (or overridden via `SHADOW_DB_PATH` or `--db` flag).
  2. Configure connection pragmas on initialization:
     ```sql
     PRAGMA journal_mode = WAL;
     PRAGMA synchronous = NORMAL;
     PRAGMA foreign_keys = ON;
     PRAGMA busy_timeout = 5000;
     ```
  3. Define Drizzle schema tables in `packages/shared/src/schema/`:
     - `tasks`: Core task entities with parent-child recursive linkage.
     - `task_tags`: Many-to-many tags/labels.
     - `task_events`: Append-only audit log (comments, status transitions, tool edits).
     - `remote_mappings`: Join table for $N \leftrightarrow M$ remote links.
     - `sync_queue`: Local offline mutation queue.
  4. Implement an embedded migration runner that executes pending SQL migrations on CLI startup without external migration CLIs.
- **Acceptance Criteria:**
  - [ ] Database automatically creates parent directories and initializes tables on first run.
  - [ ] Sequential writes and reads complete in $< 10\text{ms}$.
  - [ ] Concurrent processes accessing the database concurrently do not throw `SQLITE_BUSY` errors within a 5-second timeout window.
  - [ ] Database migrations execute atomically in a single transaction.

---

### `SHD-CORE-003`: Local Task Engine & Hierarchy Management
- **Milestone:** M0 (Core Local Foundation)
- **Component:** Core Business Logic
- **Dependencies:** `SHD-CORE-002`
- **Estimate:** 5 pts
- **Objective:** Implement the CRUD and hierarchy engine for tasks, epics, stories, spikes, and subtasks with cycle detection and custom state transitions.
- **Technical Requirements:**
  1. Implement `TaskService` supporting:
     - `createTask(input: CreateTaskDTO): Promise<Task>`
     - `updateTask(id: string, input: UpdateTaskDTO): Promise<Task>`
     - `getTask(id: string): Promise<TaskWithChildren>`
     - `listTasks(filter: TaskFilterDTO): Promise<Task[]>`
     - `deleteTask(id: string, recursive: boolean): Promise<void>`
  2. Implement cycle detection preventing a task from becoming its own ancestor in the hierarchy graph.
  3. Support full status state machine: `backlog` $\leftrightarrow$ `todo` $\leftrightarrow$ `in_progress` $\leftrightarrow$ `review` $\leftrightarrow$ `blocked` $\leftrightarrow$ `done`.
  4. Implement full-text search indexing on `title` and `description` via SQLite FTS5 or LIKE search.
- **Acceptance Criteria:**
  - [ ] Creating an epic and nesting 3 child tasks establishes correct foreign keys and recursive tree retrieval.
  - [ ] Attempting to set an epic's parent to one of its own descendants throws a `CycleDetectedError`.
  - [ ] Updating task status records an immutable entry in `task_events`.
  - [ ] Search query returns matching tasks in $< 15\text{ms}$ across a dataset of 1,000 tasks.

---

### `SHD-CORE-004`: Unified CLI Framework & Dual-Mode Formatter
- **Milestone:** M0 (Core Local Foundation)
- **Component:** Command Line Interface
- **Dependencies:** `SHD-CORE-003`
- **Estimate:** 5 pts
- **Objective:** Deliver the primary CLI binary with automatic dual-mode formatting: interactive, colored tables for human terminals, and strict, machine-parseable JSON for agents and scripts.
- **Technical Requirements:**
  1. Build CLI using a lightweight, zero-dependency parser (e.g., Commander or custom parser compiled with Bun).
  2. Commands implemented:
     - `shadow task add <title> [--type <type>] [--parent <id>] [--priority <1-5>] [--body-file <path>]`
     - `shadow task list [--status <status>] [--parent <id>] [--tag <tag>]`
     - `shadow task get <id>`
     - `shadow task edit <id> [--title <title>] [--status <status>]`
     - `shadow task done <id> [--comment <text>]`
     - `shadow status`
  3. Output formatting rules:
     - If `--json` flag is provided OR `process.stdout.isTTY` is false: emit clean JSON to `stdout`.
     - Operational notices and logs must strictly write to `stderr`.
     - Standardized exit codes: `0` = Success, `1` = Generic Error, `2` = Validation Error, `3` = Not Found.
  4. Stdin support: Allow piping descriptions via `--body-file -` or standard input.
- **Acceptance Criteria:**
  - [ ] `shadow task list --json | jq .` parses valid JSON array without syntax errors.
  - [ ] `shadow task add "Fix bug" --json` outputs the created task JSON with its generated ID.
  - [ ] Passing invalid flags or non-existent IDs exits with code `2` or `3` and outputs structured error on `stderr`.
  - [ ] Human terminal mode prints formatted tables with ANSI colors and relative timestamps.

---

### `SHD-CORE-005`: Git Branch & Worktree (`wt`) Context Integration
- **Milestone:** M0 (Core Local Foundation)
- **Component:** Developer Environment Hooks
- **Dependencies:** `SHD-CORE-004`
- **Estimate:** 3 pts
- **Objective:** Automatically attach the active Git repository, branch, worktree path (`wt`), and latest commit SHA to task operations.
- **Technical Requirements:**
  1. Implement `GitContextResolver`:
     - Detect if current working directory is inside a Git repository.
     - Extract current branch name (`git rev-parse --abbrev-ref HEAD`).
     - Detect Worktrunk / Git worktree root directory.
     - Capture current commit hash (`git rev-parse --short HEAD`).
  2. When creating or starting a task (`shadow task start <id>`), automatically stamp `git_branch`, `git_worktree`, and `last_commit` into task metadata.
  3. Implement `shadow status` showing tasks linked to the current Git branch.
- **Acceptance Criteria:**
  - [ ] Running `shadow task start SHD-101` inside worktree `../shadow.feature-1` sets `git_branch: "feature-1"` and `git_worktree: ".../shadow.feature-1"`.
  - [ ] `shadow status` in that directory highlights `SHD-101` as the active branch task.
  - [ ] Commands executed outside of a Git repository gracefully fall back without crashing.

---

## Milestone 1: Agent Skill Protocol & Context Engine

```
+-----------------------------------------------------------------------------------------+
|                        MILESTONE 1: AGENT SKILL & CONCURRENCY                           |
+-------------------+----------------------------------------------------+----------------+
| Ticket ID         | Title                                              | Estimate       |
+-------------------+----------------------------------------------------+----------------+
| `SHD-SKILL-001`   | Standardized Agent Skill Specification (`SKILL.md`)| 3 pts (Medium) |
| `SHD-SKILL-002`   | Agent Lifecycle Hooks & Proactive Triggers         | 3 pts (Medium) |
| `SHD-SKILL-003`   | Dual-Verification Gatekeeper & Closure Protocols   | 3 pts (Medium) |
| `SHD-SKILL-004`   | Subagent Concurrency & SQLite WAL Stress Harness   | 5 pts (Large)  |
| `SHD-SKILL-005`   | Context Injection Subcommand (`shadow context`)    | 3 pts (Medium) |
+-------------------+----------------------------------------------------+----------------+
```

---

### `SHD-SKILL-001`: Standardized Agent Skill Specification (`SKILL.md`)
- **Milestone:** M1 (Agent-Native)
- **Component:** Agent Skill Documentation & Manifest
- **Dependencies:** `SHD-CORE-004`
- **Estimate:** 3 pts
- **Objective:** Create and package the official `SKILL.md` file that instructs any LLM agent (Antigravity, Claude Code, Cursor) on how to interface with Shadow via CLI.
- **Technical Requirements:**
  1. Write production `skills/shadow/SKILL.md` with YAML frontmatter:
     ```yaml
     name: shadow
     description: "Local-first project management system for developers and AI agents."
     triggers:
       - "session start"
       - "task pivot"
       - "context switch"
       - "blocker declared"
       - "task completion"
     ```
  2. Document standard CLI interaction idioms for agents:
     - Always use `--json` for querying.
     - Always use `--non-interactive` or `-y` for mutations.
     - Writing multi-line descriptions via temporary files or stdin.
  3. Include copy/install script to install the skill globally to `~/.gemini/config/skills/shadow/` and `.claude/skills/`.
- **Acceptance Criteria:**
  - [ ] An LLM agent provided with `SKILL.md` can successfully parse tasks, identify the active task, and execute CLI commands without human intervention.
  - [ ] Skill contains concrete markdown examples for decomposing an epic into atomic subtasks.

---

### `SHD-SKILL-002`: Agent Lifecycle Hooks & Proactive Triggers
- **Milestone:** M1 (Agent-Native)
- **Component:** Agent Behavioral Guidelines
- **Dependencies:** `SHD-SKILL-001`
- **Estimate:** 3 pts
- **Objective:** Codify explicit agent behavioral rules to proactively manage task state during context switches, task pivots, and session wraps.
- **Technical Requirements:**
  1. Define the **Anti-Ghost Work Protocol** in `SKILL.md`:
     - If the user asks to start a new feature or fix a bug without an existing task, the agent MUST immediately invoke `shadow task add` before touching source code.
  2. Define the **Context Switch Protocol**:
     - When switching between tasks, the agent must mark the previous task as `blocked` or paused and transition the new task to `in_progress`.
  3. Define the **Session Wrap-Up Protocol**:
     - At end-of-session, append a structured progress comment with modified files and outstanding checklist items.
- **Acceptance Criteria:**
  - [ ] Simulated agent session follows the protocol: creates task first, logs commits, updates checklist on completion.
  - [ ] Unplanned pivots automatically create an `ad-hoc` task without losing previous task state.

---

### `SHD-SKILL-003`: Dual-Verification Gatekeeper & Closure Protocols
- **Milestone:** M1 (Agent-Native)
- **Component:** Quality Gate Engine
- **Dependencies:** `SHD-SKILL-002`
- **Estimate:** 3 pts
- **Objective:** Prevent agents from prematurely closing tasks when tests fail, blockers remain, or acceptance criteria are unverified.
- **Technical Requirements:**
  1. Implement CLI verification check: `shadow task done <id> --verify-cmd "<command>"`.
     - Executes the verification command (e.g. `bun test`).
     - If command exits non-zero, task completion is rejected, error output is logged to `task_events`, and task status remains `in_progress` or `blocked`.
  2. Define mandatory checklist completion rule:
     - If a task body contains `- [ ]` checklist items, `shadow task done` warns or requires `--force` if unchecked items remain.
  3. Add audit event logging the verification command output and status.
- **Acceptance Criteria:**
  - [ ] `shadow task done SHD-1 --verify-cmd "exit 1"` fails with exit code `2`, leaving the task `in_progress`.
  - [ ] `shadow task done SHD-1 --verify-cmd "exit 0"` marks the task `done` and records verification metadata.
  - [ ] Unchecked checklist items block closure unless `--force` is supplied.

---

### `SHD-SKILL-004`: Subagent Concurrency & SQLite WAL Stress Harness
- **Milestone:** M1 (Agent-Native)
- **Component:** Concurrency & Stress Testing
- **Dependencies:** `SHD-CORE-002`, `SHD-CORE-004`
- **Estimate:** 5 pts
- **Objective:** Guarantee that multiple parallel AI subagents (e.g., 5 concurrent background workers) can perform simultaneous reads, writes, and status updates without database locking collisions.
- **Technical Requirements:**
  1. Implement exponential backoff retry in `packages/cli/src/db.ts`:
     - Handle `SQLITE_BUSY` errors with random jitter (10ms - 200ms) up to 10 retries.
  2. Build a standalone concurrency stress test (`tests/concurrency_stress.ts`):
     - Spawn 10 parallel worker processes.
     - Each worker executes 50 random task operations (`add`, `update`, `comment`, `list`).
     - Verify database integrity and verify zero failed transactions or dropped writes.
- **Acceptance Criteria:**
  - [ ] 10 parallel processes complete 500 total operations with zero uncaught `SQLITE_BUSY` errors.
  - [ ] All 500 operations are verified present in `task_events` without data corruption.

---

### `SHD-SKILL-005`: Context Injection Subcommand (`shadow context`)
- **Milestone:** M1 (Agent-Native)
- **Component:** Agent Prompt Injection Helper
- **Dependencies:** `SHD-CORE-005`, `SHD-SKILL-001`
- **Estimate:** 3 pts
- **Objective:** Provide a fast CLI command that outputs a concise, structured markdown summary of the developer's active task, recent comments, and subtasks for direct injection into agent system prompts.
- **Technical Requirements:**
  1. Implement `shadow context [--format json|prompt|compact]`.
  2. Context payload includes:
     - Active project and Git branch.
     - Current `in_progress` task title, description, and unchecked checklist items.
     - Associated remote tickets (Jira keys).
     - Recent 3 event log comments.
  3. Benchmark execution: Must complete in $< 10\text{ms}$ to ensure zero latency impact on agent turn starts.
- **Acceptance Criteria:**
  - [ ] `shadow context --format prompt` outputs clean, token-efficient markdown ready for agent context.
  - [ ] Execution completes in $< 10\text{ms}$.

---

## Milestone 2: Cloudflare Edge Bridge (`shadow-edge`)

```
+-----------------------------------------------------------------------------------------+
|                     MILESTONE 2: CLOUDFLARE EDGE INFRASTRUCTURE                         |
+-------------------+----------------------------------------------------+----------------+
| Ticket ID         | Title                                              | Estimate       |
+-------------------+----------------------------------------------------+----------------+
| `SHD-CF-001`      | Cloudflare Worker API & Wrangler Setup             | 3 pts (Medium) |
| `SHD-CF-002`      | Cloudflare D1 Edge Schema & Drizzle Parity         | 3 pts (Medium) |
| `SHD-CF-003`      | Atlassian Jira OAuth 2.0 3LO Broker on Workers    | 5 pts (Large)  |
| `SHD-CF-004`      | Cloudflare Queues Webhook Receiver & Buffer        | 5 pts (Large)  |
| `SHD-CF-005`      | Local CLI Auth Dance & OS Keychain Store           | 3 pts (Medium) |
+-------------------+----------------------------------------------------+----------------+
```

---

### `SHD-CF-001`: Cloudflare Worker API & Wrangler Setup
- **Milestone:** M2 (Cloud Infrastructure)
- **Component:** Cloudflare Workers
- **Dependencies:** `SHD-CORE-001`
- **Estimate:** 3 pts
- **Objective:** Scaffold the `packages/edge` Cloudflare Worker application with Wrangler, route handlers, authentication middleware, and CORS configuration.
- **Technical Requirements:**
  1. Configure `packages/edge/wrangler.toml` with compatibility date and flags:
     ```toml
     name = "shadow-edge"
     main = "src/index.ts"
     compatibility_date = "2026-09-01"
     compatibility_flags = ["nodejs_compat"]
     ```
  2. Implement router (using Hono or Itty-Router) with endpoints:
     - `GET /health`
     - `GET /v1/auth/jira/authorize`
     - `GET /v1/auth/jira/callback`
     - `POST /v1/sync/push`
     - `GET /v1/sync/pull`
     - `POST /v1/webhooks/jira`
  3. Implement Bearer token authentication middleware validating incoming CLI requests against Cloudflare D1 user API keys.
- **Acceptance Criteria:**
  - [ ] `wrangler dev` starts local edge server with working `/health` endpoint.
  - [ ] Unauthorized requests to `/v1/sync/*` return `401 Unauthorized` with JSON error.

---

### `SHD-CF-002`: Cloudflare D1 Edge Schema & Drizzle Parity
- **Milestone:** M2 (Cloud Infrastructure)
- **Component:** Cloudflare D1 Database
- **Dependencies:** `SHD-CF-001`, `SHD-CORE-002`
- **Estimate:** 3 pts
- **Objective:** Deploy and verify the synchronized database schema on Cloudflare D1 using Drizzle ORM, ensuring 100% schema parity between local SQLite and edge D1.
- **Technical Requirements:**
  1. Bind D1 database `SHADOW_EDGE_D1` in `wrangler.toml`.
  2. Reuse the Drizzle schema definitions from `packages/shared/src/schema/`.
  3. Implement D1 migration script: `bun run migrate:d1` via `wrangler d1 migrations apply`.
  4. Create edge repository methods in `packages/edge/src/db.ts` using `drizzle-orm/d1`.
- **Acceptance Criteria:**
  - [ ] D1 migrations run successfully against local Miniflare D1 and Cloudflare remote D1.
  - [ ] TypeScript types are identical between local SQLite queries and edge D1 queries without type casting.

---

### `SHD-CF-003`: Atlassian Jira OAuth 2.0 3LO Broker on Workers
- **Milestone:** M2 (Cloud Infrastructure)
- **Component:** Cloudflare Edge Auth Broker
- **Dependencies:** `SHD-CF-001`
- **Estimate:** 5 pts
- **Objective:** Implement the Jira Cloud 3-legged OAuth (3LO) authorization flow inside the Cloudflare Worker, eliminating the need for developers to expose local ports or tunnels.
- **Technical Requirements:**
  1. `GET /v1/auth/jira/authorize`:
     - Generate state nonce and store in Cloudflare KV (`SHADOW_KV_SESSIONS`).
     - Redirect browser to `https://auth.atlassian.com/authorize` with scopes (`read:jira-work`, `write:jira-work`, `offline_access`).
  2. `GET /v1/auth/jira/callback`:
     - Validate state nonce.
     - Exchange authorization code for Atlassian `access_token` and `refresh_token`.
     - Fetch accessible Jira Cloud resources (`https://api.atlassian.com/oauth/token/accessible-resources`).
     - Store encrypted tokens in Cloudflare D1 linked to the user account.
     - Display clean success page instructing developer to return to their terminal.
- **Acceptance Criteria:**
  - [ ] Complete OAuth flow redirects to Atlassian, requests permission, and successfully captures tokens on callback.
  - [ ] Invalid or tampered state parameters return `400 Bad Request`.
  - [ ] Refresh token flow successfully rotates expired access tokens automatically.

---

### `SHD-CF-004`: Cloudflare Queues Webhook Receiver & Buffer
- **Milestone:** M2 (Cloud Infrastructure)
- **Component:** Cloudflare Queues & Webhooks
- **Dependencies:** `SHD-CF-002`
- **Estimate:** 5 pts
- **Objective:** Ingest Jira Cloud webhooks at the edge, verify HMAC signatures, buffer payloads in Cloudflare Queues, and process events into the D1 sync mailbox without overloading Jira rate limits.
- **Technical Requirements:**
  1. Configure Cloudflare Queue `JIRA_WEBHOOK_QUEUE` in `wrangler.toml`.
  2. `POST /v1/webhooks/jira`:
     - Validate webhook HMAC signature header (`X-Hub-Signature` or Atlassian webhook secret).
     - Push raw webhook payload into `JIRA_WEBHOOK_QUEUE` and immediately return `200 OK`.
  3. Implement Queue consumer handler in `packages/edge/src/queue_consumer.ts`:
     - Parse Jira event (`jira:issue_updated`, `comment_created`).
     - Upsert remote ticket cache in D1 (`remote_entity_cache`).
     - Record update in user's sync inbox for the next local pull.
- **Acceptance Criteria:**
  - [ ] Webhook endpoint returns `200 OK` in $< 30\text{ms}$.
  - [ ] Inbound webhook events are successfully consumed from the queue and written to D1.
  - [ ] Malformed or unauthorized webhooks are rejected with `401 Unauthorized`.

---

### `SHD-CF-005`: Local CLI Auth Dance & OS Keychain Store
- **Milestone:** M2 (Cloud Infrastructure)
- **Component:** Local Auth & Secret Management
- **Dependencies:** `SHD-CF-003`, `SHD-CORE-004`
- **Estimate:** 3 pts
- **Objective:** Implement `shadow auth login` in the local CLI to authenticate with the Cloudflare Edge Bridge and securely store API keys in the macOS/Linux OS Keychain.
- **Technical Requirements:**
  1. Implement `shadow auth login`:
     - Generate a temporary session pairing code.
     - Open the Cloudflare Edge auth URL in the developer's default browser (`open <url>`).
     - Poll `POST /v1/auth/session/claim` with timeout (2 minutes) until authenticated.
  2. Store the returned edge API token securely:
     - Use `keytar` or native OS tools (`security add-generic-password` on macOS, `secret-tool` on Linux).
     - Fallback to encrypted file `~/.config/shadow/.credentials` (0600 permissions) if keychain is unavailable.
  3. Implement `shadow auth status` and `shadow auth logout`.
- **Acceptance Criteria:**
  - [ ] Running `shadow auth login` opens browser, completes auth, and saves token to Keychain.
  - [ ] `shadow auth status` prints active user identity and expiration.
  - [ ] Zero plaintext tokens stored in config files or git repositories.

---

## Milestone 3: $N \leftrightarrow M$ Mapping, Rollup & Jira Sync Engine

```
+-----------------------------------------------------------------------------------------+
|                       MILESTONE 3: N <-> M SYNC & JIRA CONNECTOR                        |
+-------------------+----------------------------------------------------+----------------+
| Ticket ID         | Title                                              | Estimate       |
+-------------------+----------------------------------------------------+----------------+
| `SHD-SYNC-001`    | The $N \leftrightarrow M$ Relational Mapping Engine| 5 pts (Large)  |
| `SHD-SYNC-002`    | Rollup Synthesis & ADF Document Converter          | 5 pts (Large)  |
| `SHD-SYNC-003`    | Privacy & Sanitization Firewall                    | 3 pts (Medium) |
| `SHD-SYNC-004`    | Jira Cloud REST v3 Client & Rate-Limited Transport | 5 pts (Large)  |
| `SHD-SYNC-005`    | Offline Mutation Queue & Reconciliation Engine     | 5 pts (Large)  |
+-------------------+----------------------------------------------------+----------------+
```

---

### `SHD-SYNC-001`: The $N \leftrightarrow M$ Relational Mapping Engine
- **Milestone:** M3 (Core Differentiator)
- **Component:** Relational Mapping Subsystem
- **Dependencies:** `SHD-CORE-003`, `SHD-CF-002`
- **Estimate:** 5 pts
- **Objective:** Implement the core linkage engine supporting arbitrary many-to-many associations between local tasks/epics and remote Jira tickets.
- **Technical Requirements:**
  1. Implement CLI commands:
     - `shadow link <local_id> jira:<remote_key> [--relation tracks|subtask_of|blocks] [--rollup checklist|comment|status]`
     - `shadow unlink <local_id> jira:<remote_key>`
     - `shadow links [local_id | remote_key]`
  2. Implement mapping graph resolver:
     - Resolve all local tasks contributing to a single remote Jira issue ($N \rightarrow 1$).
     - Resolve all remote Jira tickets affected by a single local epic or task ($1 \rightarrow M$).
  3. Validate link integrity and persist mappings in local SQLite and mirror to Cloudflare D1.
- **Acceptance Criteria:**
  - [ ] Linking 4 local tasks to Jira issue `ENG-101` correctly associates all 4 in the database.
  - [ ] `shadow links ENG-101` lists all 4 local tasks with their current statuses.
  - [ ] Unlinking cleans up foreign keys without deleting local tasks.

---

### `SHD-SYNC-002`: Rollup Synthesis & ADF Document Converter
- **Milestone:** M3 (Core Differentiator)
- **Component:** Projection & Format Transformation
- **Dependencies:** `SHD-SYNC-001`
- **Estimate:** 5 pts
- **Objective:** Synthesize multiple local task states into polished rollup updates formatted in both standard Markdown and Jira Atlassian Document Format (ADF).
- **Technical Requirements:**
  1. Implement `RollupSynthesizer`:
     - Given a remote key (e.g. `ENG-101`), query all linked local tasks.
     - Generate structured progress summary:
       - Header with completion percentage (e.g. `Progress: 3/4 completed (75%)`).
       - Markdown checklist of tasks with commit hashes.
       - Outstanding blockers and in-progress items.
  2. Implement bidirectional `MarkdownToADFConverter`:
     - Convert headings, bold/italic, code blocks, bulleted lists, and task lists (`- [ ]`, `- [x]`) to valid Atlassian Document Format JSON schema.
     - Validate output against Atlassian JSON schema validator.
- **Acceptance Criteria:**
  - [ ] Synthesizer outputs clean, human-readable markdown summaries.
  - [ ] ADF output validates 100% against Jira Cloud REST API v3 schema without 400 Bad Request errors.
  - [ ] Unit test suite validates round-trip conversion for all standard markdown formatting.

---

### `SHD-SYNC-003`: Privacy & Sanitization Firewall
- **Milestone:** M3 (Core Differentiator)
- **Component:** Security & Compliance Firewall
- **Dependencies:** `SHD-SYNC-002`
- **Estimate:** 3 pts
- **Objective:** Enforce strict redaction and filtering rules on all outbound payloads before any data is synced to Cloudflare or Jira.
- **Technical Requirements:**
  1. Implement `FirewallFilter`:
     - Drop any task marked `isPrivate: true` from outbound synchronization.
     - Strip designated local fields: `notes`, `agent_scratchpad`, `stacktraces`, `internal_cost`.
     - Mask absolute filesystem paths (e.g. `/Users/username/projects/...` $\rightarrow$ `~/projects/...`).
     - Redact sensitive token patterns using regular expressions (AWS keys, GitHub PATs, JWT tokens, internal IP ranges).
  2. Implement `shadow sync --dry-run`:
     - Print a colored unified diff showing the exact text and fields that will be sent upstream, highlighting redacted content.
- **Acceptance Criteria:**
  - [ ] Private tasks never appear in any sync payload.
  - [ ] API keys matching `AKIA*` or `ghp_*` are replaced with `[REDACTED]`.
  - [ ] `--dry-run` displays accurate diff without performing remote network calls.

---

### `SHD-SYNC-004`: Jira Cloud REST v3 Client & Rate-Limited Transport
- **Milestone:** M3 (Core Differentiator)
- **Component:** Remote API Client
- **Dependencies:** `SHD-CF-003`, `SHD-SYNC-002`
- **Estimate:** 5 pts
- **Objective:** Build the Jira Cloud REST v3 client executing ticket updates, status transitions, and comment posting with token refresh and rate-limit backoff.
- **Technical Requirements:**
  1. Implement `JiraClient` in `packages/edge`:
     - `getIssue(key: string): Promise<JiraIssue>`
     - `addComment(key: string, bodyADF: object): Promise<void>`
     - `updateIssue(key: string, fields: object): Promise<void>`
     - `getTransitions(key: string): Promise<JiraTransition[]>`
     - `transitionIssue(key: string, transitionId: string): Promise<void>`
  2. Handle rate limits (`HTTP 429`):
     - Parse `Retry-After` header and delay execution.
  3. Automatic token refresh: If access token has expired (`HTTP 401`), invoke Cloudflare Worker token rotation and retry once.
- **Acceptance Criteria:**
  - [ ] Successfully creates comments and updates descriptions on Jira Cloud instances.
  - [ ] Correctly resolves and executes Jira workflow transitions (e.g. 'In Progress' $\rightarrow$ 'Done').
  - [ ] Automatically recovers from expired access tokens without user interruption.

---

### `SHD-SYNC-005`: Offline Mutation Queue & Reconciliation Engine
- **Milestone:** M3 (Core Differentiator)
- **Component:** Sync State Machine & Offline Engine
- **Dependencies:** `SHD-SYNC-004`, `SHD-CORE-002`
- **Estimate:** 5 pts
- **Objective:** Provide robust offline-first synchronization: queue outbound changes locally when disconnected, reconcile remote updates on reconnect, and handle merge conflicts.
- **Technical Requirements:**
  1. Local `sync_queue` table records all pending pushes with timestamp and payload.
  2. Implement `shadow sync`:
     - Phase 1 (Drain Queue): Send pending mutations sequentially to `shadow-edge`.
     - Phase 2 (Pull Remote): Fetch remote updates from Cloudflare D1 cache.
     - Phase 3 (Conflict Detection): If remote modified timestamp $>$ local sync timestamp, trigger conflict resolution.
  3. Conflict policies:
     - `--strategy ours`: Local developer edits overwrite remote.
     - `--strategy theirs`: Remote Jira changes overwrite local.
     - `--strategy prompt` (default): Prompt user with diff.
- **Acceptance Criteria:**
  - [ ] Mutations performed with network disconnected are successfully persisted to `sync_queue`.
  - [ ] When connectivity returns, `shadow sync` replays all queued actions chronologically.
  - [ ] Conflicting updates flag cleanly with user diff prompt and exit code `3`.

---

## Milestone 4: Developer TUI & Cloudflare Edge Dashboard

```
+-----------------------------------------------------------------------------------------+
|                  MILESTONE 4: DEVELOPER TUI & CLOUDFLARE WEB VIEWER                     |
+-------------------+----------------------------------------------------+----------------+
| Ticket ID         | Title                                              | Estimate       |
+-------------------+----------------------------------------------------+----------------+
| `SHD-TUI-001`     | Interactive Terminal Dashboard (TUI)               | 5 pts (Large)  |
| `SHD-TUI-002`     | Git Hook Auto-Sync Integrations (`pre-push`)       | 2 pts (Small)  |
| `SHD-WEB-001`     | Cloudflare Pages Read-Only Stakeholder Viewer      | 5 pts (Large)  |
| `SHD-DOCS-001`    | Developer Documentation & CLI Reference            | 3 pts (Medium) |
| `SHD-QA-001`      | End-to-End Simulation & Verification Test Suite    | 5 pts (Large)  |
+-------------------+----------------------------------------------------+----------------+
```

---

### `SHD-TUI-001`: Interactive Terminal Dashboard (TUI)
- **Milestone:** M4 (Polish & Visibility)
- **Component:** Terminal User Interface
- **Dependencies:** `SHD-CORE-004`
- **Estimate:** 5 pts
- **Objective:** Build a lightning-fast, keyboard-driven terminal dashboard for developers to browse tasks, view hierarchies, inspect Jira links, and trigger syncs.
- **Technical Requirements:**
  1. Build TUI using standard terminal UI libraries (e.g. `ink` for React/TypeScript or blessed-like renderer compiled into Bun binary).
  2. Features:
     - Kanban column view (`Todo`, `In Progress`, `Done`).
     - Task hierarchy tree view.
     - Keybindings: `j`/`k` (navigate), `Enter` (inspect), `Space` (toggle status), `s` (sync), `q` (quit).
     - Live indicator of sync queue status and offline state.
- **Acceptance Criteria:**
  - [ ] Running `shadow ui` opens interactive TUI in $< 40\text{ms}$.
  - [ ] Status changes in TUI immediately persist to local SQLite and refresh view.
  - [ ] Resizing terminal window resizes dashboard without visual artifacts.

---

### `SHD-TUI-002`: Git Hook Auto-Sync Integrations (`pre-push`, `post-commit`)
- **Milestone:** M4 (Polish & Visibility)
- **Component:** Git Automation
- **Dependencies:** `SHD-SYNC-005`, `SHD-CORE-005`
- **Estimate:** 2 pts
- **Objective:** Provide automated Git hook installation to sync tasks on git commit and git push events without manual commands.
- **Technical Requirements:**
  1. Implement `shadow hook install [--post-commit] [--pre-push]`.
  2. `post-commit` hook:
     - Check if current commit message contains `SHD-XXX` or if active branch has an assigned task.
     - Appends commit hash to task event log.
  3. `pre-push` hook:
     - Executes `shadow sync push --quiet` in the background before pushing code.
- **Acceptance Criteria:**
  - [ ] Running `shadow hook install` writes clean hook scripts to `.git/hooks/`.
  - [ ] `git commit` automatically updates linked task event log with commit SHA.
  - [ ] `git push` triggers background sync without noticeable delay on git push.

---

### `SHD-WEB-001`: Cloudflare Pages Read-Only Stakeholder Viewer
- **Milestone:** M4 (Polish & Visibility)
- **Component:** Cloudflare Pages Web App
- **Dependencies:** `SHD-CF-002`, `SHD-SYNC-002`
- **Estimate:** 5 pts
- **Objective:** Deploy a fast, static web application on Cloudflare Pages connected to Cloudflare D1, providing an executive/manager read-only view of rollups and task progress.
- **Technical Requirements:**
  1. Build lightweight React/Vite web application under `packages/web`.
  2. Deploy via Cloudflare Pages or Cloudflare Workers Static Assets.
  3. Features:
     - View project rollups and task completion metrics.
     - View mapping between local tasks and Jira tickets.
     - Zero edit capabilities (strictly read-only).
  4. Authentication: Protected by Cloudflare Zero Trust Access or shared read-only link tokens.
- **Acceptance Criteria:**
  - [ ] Stakeholder can access web dashboard via browser and see live synced project rollups.
  - [ ] No local-only private tasks or un-synced scratchpad notes appear on the web view.
  - [ ] Page loads in $< 500\text{ms}$ globally on Cloudflare edge CDN.

---

### `SHD-DOCS-001`: Developer Documentation & CLI Reference
- **Milestone:** M4 (Polish & Visibility)
- **Component:** Documentation & Onboarding
- **Dependencies:** `SHD-CORE-004`, `SHD-SKILL-001`
- **Estimate:** 3 pts
- **Objective:** Provide comprehensive documentation, quickstart guides, CLI manpages, and installation scripts.
- **Technical Requirements:**
  1. Rewrite `README.md` with:
     - Quickstart (Installation via curl/brew).
     - Architecture overview diagram.
     - CLI Command Reference table.
     - AI Agent Setup guide (Antigravity & Claude Code).
     - Jira integration walkthrough.
  2. Create one-line install script: `curl -fsSL https://shadow.dev/install.sh | sh`.
- **Acceptance Criteria:**
  - [ ] New developer can install and create their first task in under 2 minutes following the quickstart.
  - [ ] All CLI commands and flags are documented with code examples.

---

### `SHD-QA-001`: End-to-End Simulation & Verification Test Suite
- **Milestone:** M4 (Polish & Visibility)
- **Component:** Quality Assurance & E2E Testing
- **Dependencies:** All previous tickets
- **Estimate:** 5 pts
- **Objective:** Implement an automated end-to-end simulation suite that tests the entire lifecycle from local task creation, agent decomposition, offline caching, Cloudflare edge relay, and Jira mock sync.
- **Technical Requirements:**
  1. Build E2E test harness in `tests/e2e_simulation.test.ts`:
     - Spawns compiled `shadow` CLI binary.
     - Simulates AI agent breaking down an imported Jira epic into 4 local tasks.
     - Simulates subagent completing tasks and running verification commands.
     - Disconnects mock network, performs mutations, verifies queue.
     - Restores network, triggers `shadow sync`, verifies mock Jira received sanitized ADF rollup.
  2. Add GitHub Actions CI workflow running lint, unit tests, and E2E simulation on macOS and Ubuntu runners.
- **Acceptance Criteria:**
  - [ ] Automated E2E test runs from scratch and passes cleanly in CI.
  - [ ] Zero unhandled rejections, memory leaks, or race conditions detected.

---

*End of Low-Level Engineering Ticket Breakdown.*
