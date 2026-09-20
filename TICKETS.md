# Shadow MVP Granular Engineering Ticket Specifications (v2.0)

**Document Version:** 2.0.0  
**Associated Roadmap:** [ROADMAP.md](file:///Users/jacobmiller22/projects/shadow.feature-3-mvp-roadmap/ROADMAP.md)  
**Total Tickets:** 64 Granular Engineering Specifications  
**Milestone Breakdown:**  
- **Milestone 0 (Core Local Foundation & Multi-Worktree Concurrency):** 12 Tickets  
- **Milestone 1 (Agent Skill Protocol, Idempotency & Verification):** 13 Tickets  
- **Milestone 2 (Cloudflare Edge Bridge & OAuth Mutex):** 14 Tickets  
- **Milestone 3 (N <-> M Mapping, Dynamic Jira Introspection & Sync):** 13 Tickets  
- **Milestone 4 (Developer TUI, Web Viewer & Release Operations):** 12 Tickets  

---

## Milestone 0: Core Local Foundation & Multi-Worktree Concurrency (12 Tickets)

```
+---------------------------------------------------------------------------------------------------------+
|                                    MILESTONE 0 TICKETS OVERVIEW                                         |
+-------------------+---------------------------------------------------------------+---------------------+
| Ticket ID         | Title                                                         | Estimate (Points)   |
+-------------------+---------------------------------------------------------------+---------------------+
| `SHD-CORE-001`    | Monorepo Scaffolding & Bun Toolchain Configuration            | 2 pts (Small)       |
| `SHD-CORE-002`    | Multi-Environment Isolation & Database Path Resolver          | 3 pts (Medium)      |
| `SHD-CORE-003`    | SQLite WAL Configuration, Pragmas & Checkpointing Subsystem   | 3 pts (Medium)      |
| `SHD-CORE-004`    | Embedded SQLite Migrations Engine & Drizzle ORM Setup         | 3 pts (Medium)      |
| `SHD-CORE-005`    | Core Task Table Schema & Recursive Hierarchy Drizzle Models   | 3 pts (Medium)      |
| `SHD-CORE-006`    | Task Service CRUD Operations & Cycle Detection Logic          | 5 pts (Large)       |
| `SHD-CORE-007`    | SQLite FTS5 Full-Text Search Engine & Query Builder           | 3 pts (Medium)      |
| `SHD-CORE-008`    | Git Context & Worktrunk (`wt`) Workspace ID Binding           | 3 pts (Medium)      |
| `SHD-CORE-009`    | Unified CLI Entrypoint & Argument Parsing Framework           | 3 pts (Medium)      |
| `SHD-CORE-010`    | Dual-Mode Formatter (Human ANSI Tables vs Agent JSON)         | 3 pts (Medium)      |
| `SHD-CORE-011`    | Stdin Stream & Markdown File Ingestion (`--body-file`)        | 2 pts (Small)       |
| `SHD-CORE-012`    | SQLite Disaster Recovery & Automated Snapshot Backup Engine   | 5 pts (Large)       |
+-------------------+---------------------------------------------------------------+---------------------+
```

---

### `SHD-CORE-001`: Monorepo Scaffolding & Bun Toolchain Configuration
- **Milestone:** M0
- **Component:** Core Toolchain / Build System
- **Dependencies:** None
- **Estimate:** 2 pts
- **Objective:** Establish the Bun workspace monorepo layout that enables 100% TypeScript code and type sharing between the local CLI and Cloudflare Workers.
- **Technical Specifications:**
  - Initialize workspace packages: `packages/shared`, `packages/cli`, `packages/edge`, `packages/web`.
  - Configure root `package.json` with workspace wildcards.
  - Setup unified `tsconfig.base.json` with `strict: true` and path alias `@shadow/shared/*`.
  - Add build target in `packages/cli`: `bun build --compile --minify --target=bun-darwin-arm64 src/index.ts --outfile bin/shadow`.
- **Acceptance Criteria:**
  - [ ] Running `bun install` links internal packages cleanly.
  - [ ] Running `bun run build:cli` produces standalone binary `bin/shadow`.
  - [ ] `./bin/shadow --version` executes in $< 20\text{ms}$.

---

### `SHD-CORE-002`: Multi-Environment Isolation & Database Path Resolver
- **Milestone:** M0
- **Component:** Persistence Architecture
- **Dependencies:** `SHD-CORE-001`
- **Estimate:** 3 pts
- **Objective:** Prevent developer dogfooding or testing on Shadow from polluting or corrupting their personal production task database.
- **Technical Specifications:**
  - Implement `EnvironmentResolver`:
    - `SHADOW_ENV=production` (Default for end users): Uses `~/.local/share/shadow/shadow.db`.
    - `SHADOW_ENV=development` (When developing Shadow): Uses `<repo-root>/.shadow-dev/shadow.db`.
    - `SHADOW_ENV=test`: Uses `:memory:` or `/tmp/shadow-test-<uuid>.db`.
  - Priority order: CLI flag `--db-path <path>` > `SHADOW_DB_PATH` > `SHADOW_ENV` lookup > Default.
  - Automatically create parent directories with strict `0700` permissions.
- **Acceptance Criteria:**
  - [ ] In test environment, no files are written to `~/.local/share/shadow/`.
  - [ ] Passing `--db-path ./custom.db` directs all reads/writes to `./custom.db`.
  - [ ] Permissions on created directories verify `0700` (read/write/execute by owner only).

---

### `SHD-CORE-003`: SQLite WAL Configuration, Pragmas & Checkpointing Subsystem
- **Milestone:** M0
- **Component:** Storage Subsystem
- **Dependencies:** `SHD-CORE-002`
- **Estimate:** 3 pts
- **Objective:** Configure SQLite for maximum durability, sub-10ms latency, and crash resilience across concurrent processes.
- **Technical Specifications:**
  - Connection pragmas:
    ```sql
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 10000;
    PRAGMA wal_autocheckpoint = 1000;
    ```
  - Implement automatic checkpoint on CLI exit (`PRAGMA wal_checkpoint(PASSIVE)`).
  - Implement retry wrapper with random exponential backoff jitter (10ms - 250ms) for `SQLITE_BUSY` errors.
- **Acceptance Criteria:**
  - [ ] Database operates in WAL mode verified via `PRAGMA journal_mode`.
  - [ ] WAL autocheckpoint prevents WAL file growth beyond 4MB during typical usage.
  - [ ] 5 concurrent node processes writing simultaneously do not throw `SQLITE_BUSY`.

---

### `SHD-CORE-004`: Embedded SQLite Migrations Engine & Drizzle ORM Setup
- **Milestone:** M0
- **Component:** Database Schema Management
- **Dependencies:** `SHD-CORE-003`
- **Estimate:** 3 pts
- **Objective:** Create an in-binary zero-dependency database migration runner that executes pending SQL migrations automatically on startup.
- **Technical Specifications:**
  - Create `__shadow_migrations` table tracking applied migration version, name, and timestamp.
  - Embed raw SQL migration scripts inside the binary at compile time.
  - Runner acquires exclusive migration transaction:
    ```sql
    BEGIN IMMEDIATE;
    -- apply unapplied migrations
    COMMIT;
    ```
  - Expose CLI command `shadow db migrate status`.
- **Acceptance Criteria:**
  - [ ] Blank database automatically runs all migrations to latest schema in $< 15\text{ms}$.
  - [ ] If a migration fails, transaction rolls back cleanly leaving previous state intact.
  - [ ] Up-to-date database incurs $< 2\text{ms}$ overhead checking migration status.

---

### `SHD-CORE-005`: Core Task Table Schema & Recursive Hierarchy Drizzle Models
- **Milestone:** M0
- **Component:** Data Models
- **Dependencies:** `SHD-CORE-004`
- **Estimate:** 3 pts
- **Objective:** Define Drizzle ORM schema for tasks, tags, and audit events with support for arbitrary recursive parent-child hierarchies.
- **Technical Specifications:**
  - Define `tasks` table in `packages/shared/src/schema/tasks.ts`:
    - `id`: String (e.g. `SHD-101` or ULID)
    - `workspace_id`: String (Git root SHA256)
    - `parent_id`: String (Self-referencing nullable foreign key)
    - `title`: String
    - `description`: String
    - `type`: Enum (`epic`, `story`, `task`, `spike`, `subtask`)
    - `status`: Enum (`backlog`, `todo`, `in_progress`, `review`, `blocked`, `done`)
    - `priority`: Integer (1 highest - 5 lowest)
    - `is_private`: Boolean (Firewall isolation flag)
    - `git_branch`: String
    - `git_worktree`: String
    - `metadata`: JSON blob
    - `created_at`, `updated_at`: Timestamps
  - Define `task_events` table (append-only audit log of status changes, comments, and edits).
- **Acceptance Criteria:**
  - [ ] Schema passes Drizzle type generation and compiles without errors.
  - [ ] Zod schema validator generated via `drizzle-zod` for payload validation.

---

### `SHD-CORE-006`: Task Service CRUD Operations & Cycle Detection Logic
- **Milestone:** M0
- **Component:** Business Logic
- **Dependencies:** `SHD-CORE-005`
- **Estimate:** 5 pts
- **Objective:** Implement the core `TaskService` with strict validation, status state machines, and cycle detection.
- **Technical Specifications:**
  - Implement `TaskService`:
    - `create(dto: CreateTaskDTO): Promise<Task>`
    - `update(id: string, dto: UpdateTaskDTO): Promise<Task>`
    - `get(id: string): Promise<TaskDetail>`
    - `list(filter: TaskFilterDTO): Promise<Task[]>`
    - `delete(id: string, cascade: boolean): Promise<void>`
  - Implement cycle detection algorithm using depth-first search (DFS):
    - Prevent `task.parent_id = child.id` or any ancestral loop.
  - Automatically log state transitions to `task_events`.
- **Acceptance Criteria:**
  - [ ] Creating parent task and child subtasks sets valid foreign keys.
  - [ ] Attempting to introduce a hierarchy cycle throws `HierarchyCycleError`.
  - [ ] Status transitions write an immutable entry to `task_events`.

---

### `SHD-CORE-007`: SQLite FTS5 Full-Text Search Engine & Query Builder
- **Milestone:** M0
- **Component:** Search Subsystem
- **Dependencies:** `SHD-CORE-006`
- **Estimate:** 3 pts
- **Objective:** Provide sub-10ms full-text keyword search across tasks, descriptions, and comments.
- **Technical Specifications:**
  - Initialize SQLite FTS5 virtual table `tasks_fts` indexing `id`, `title`, `description`.
  - Add SQLite triggers on `tasks` (INSERT, UPDATE, DELETE) to keep `tasks_fts` automatically synchronized.
  - Implement `TaskService.search(query: string, options: SearchOptions)`.
- **Acceptance Criteria:**
  - [ ] Full-text query matches partial keywords, phrases, and prefix queries.
  - [ ] Search across 5,000 tasks executes in $< 10\text{ms}$.
  - [ ] Updating a task title immediately updates search index results.

---

### `SHD-CORE-008`: Git Context & Worktrunk (`wt`) Workspace ID Binding
- **Milestone:** M0
- **Component:** Git Environment Resolver
- **Dependencies:** `SHD-CORE-006`
- **Estimate:** 3 pts
- **Objective:** Automatically detect and bind the active Git repository root, current branch, worktree path, and commit SHA to tasks.
- **Technical Specifications:**
  - Implement `GitContext`:
    - Discover git repository root (`git rev-parse --show-toplevel`).
    - Compute `workspace_id = sha256(git_common_dir_path)`.
    - Detect current branch (`git rev-parse --abbrev-ref HEAD`).
    - Detect worktree directory (`git rev-parse --git-dir` vs `--show-toplevel`).
  - Tasks created or started inside a Git directory automatically bind this context.
- **Acceptance Criteria:**
  - [ ] Running in a Worktrunk worktree (`../repo.feature-1`) correctly captures worktree path and branch.
  - [ ] Running outside a Git repo falls back gracefully to `workspace_id: "global"`.

---

### `SHD-CORE-009`: Unified CLI Entrypoint & Argument Parsing Framework
- **Milestone:** M0
- **Component:** CLI Framework
- **Dependencies:** `SHD-CORE-006`, `SHD-CORE-008`
- **Estimate:** 3 pts
- **Objective:** Scaffold the primary CLI command hierarchy with subcommands, aliases, help text, and global options.
- **Technical Specifications:**
  - Commands:
    - `shadow task add <title>`
    - `shadow task list`
    - `shadow task get <id>`
    - `shadow task edit <id>`
    - `shadow task done <id>`
    - `shadow status`
  - Global flags: `--json`, `--db-path`, `--quiet`, `--workspace`, `--all-workspaces`.
- **Acceptance Criteria:**
  - [ ] `shadow --help` outputs clear, categorized command reference.
  - [ ] Unknown flags or missing required arguments exit with code `2` (Validation Error).

---

### `SHD-CORE-010`: Dual-Mode Formatter (Human ANSI Tables vs Agent JSON)
- **Milestone:** M0
- **Component:** CLI Formatting & Machine Contract
- **Dependencies:** `SHD-CORE-009`
- **Estimate:** 3 pts
- **Objective:** Guarantee that agents get pure, deterministic JSON on `stdout` while human developers get styled ANSI tables.
- **Technical Specifications:**
  - If `opts.json === true` OR `!process.stdout.isTTY`:
    - Output raw JSON stringified to `stdout`.
    - Operational messages / warnings written strictly to `stderr`.
  - If human TTY:
    - Render colored table with columns: `ID`, `Type`, `Status`, `Title`, `Branch`, `Age`.
  - Standardized JSON error response format on failure:
    ```json
    { "error": { "code": "NOT_FOUND", "message": "Task SHD-999 not found" } }
    ```
- **Acceptance Criteria:**
  - [ ] `shadow task list --json | jq .` parses cleanly without ANSI color code pollution.
  - [ ] Errors produce structured JSON on `stderr` and non-zero exit codes.

---

### `SHD-CORE-011`: Stdin Stream & Markdown File Ingestion (`--body-file`)
- **Milestone:** M0
- **Component:** CLI Input Processing
- **Dependencies:** `SHD-CORE-010`
- **Estimate:** 2 pts
- **Objective:** Enable human developers and agents to pass large, multi-paragraph markdown task bodies via files or stdin pipes without hitting shell escaping limits.
- **Technical Specifications:**
  - Support `--body-file <path>` on `task add` and `task edit`.
  - If `<path>` is `-`, read complete payload from `process.stdin` until EOF.
  - Validate payload size (max 512KB).
- **Acceptance Criteria:**
  - [ ] `cat spec.md | shadow task add "Implement feature" --body-file -` successfully stores full markdown.
  - [ ] Non-existent file path returns exit code `2` with descriptive error.

---

### `SHD-CORE-012`: SQLite Disaster Recovery & Automated Snapshot Backup Engine
- **Milestone:** M0
- **Component:** Reliability & Disaster Recovery
- **Dependencies:** `SHD-CORE-003`
- **Estimate:** 5 pts
- **Objective:** Ensure zero data loss by implementing automated pre-sync database snapshots, integrity verification, and crash recovery.
- **Technical Specifications:**
  - Implement `BackupService`:
    - Uses SQLite Online Backup API (`sqlite3_backup`) to create non-blocking snapshots.
    - Stored at `~/.local/share/shadow/backups/shadow_<timestamp>.db`.
    - Retention policy: Keep hourly backups for 24 hours, daily backups for 7 days.
  - Implement `shadow db backup` and `shadow db restore <path>`.
  - On startup, if an unclean shutdown flag exists, execute `PRAGMA integrity_check`.
- **Acceptance Criteria:**
  - [ ] Backup runs in background without blocking active write transactions.
  - [ ] `shadow db restore` successfully restores database from snapshot.
  - [ ] Pruning automatically removes snapshots older than retention limits.

---

## Milestone 1: Agent Skill Protocol, Idempotency & Verification (13 Tickets)

```
+---------------------------------------------------------------------------------------------------------+
|                                    MILESTONE 1 TICKETS OVERVIEW                                         |
+-------------------+---------------------------------------------------------------+---------------------+
| Ticket ID         | Title                                                         | Estimate (Points)   |
+-------------------+---------------------------------------------------------------+---------------------+
| `SHD-SKILL-001`   | Production Agent Skill Specification (`SKILL.md`)             | 3 pts (Medium)      |
| `SHD-SKILL-002`   | Skill Distribution & Multi-Agent Installation Scripts         | 2 pts (Small)       |
| `SHD-SKILL-003`   | Agent Idempotency Token Engine & Duplicate Prevention         | 3 pts (Medium)      |
| `SHD-SKILL-004`   | Anti-Ghost Work Protocol & Automatic Task Association         | 3 pts (Medium)      |
| `SHD-SKILL-005`   | Task Pivot & Context Switch Lifecycle Hooks                   | 3 pts (Medium)      |
| `SHD-SKILL-006`   | Dual-Verification Gatekeeper Engine (`--verify-cmd`)          | 3 pts (Medium)      |
| `SHD-SKILL-007`   | Markdown Checklist Parser & Completion Validator              | 3 pts (Medium)      |
| `SHD-SKILL-008`   | Session Wrap-up & Append-Only Progress Logger                 | 2 pts (Small)       |
| `SHD-SKILL-009`   | Multi-Process SQLite Concurrency & Jittered Retry Harness     | 5 pts (Large)       |
| `SHD-SKILL-010`   | Active Task Prompt Injection Helper (`shadow context`)        | 3 pts (Medium)      |
| `SHD-SKILL-011`   | Subagent Task Claiming & Worker Lock Mechanism                | 3 pts (Medium)      |
| `SHD-SKILL-012`   | Agent Anti-Bloat Output Sanitizer & Exit Code Standards       | 2 pts (Small)       |
| `SHD-SKILL-013`   | Agent Multi-Turn Task Decomposition Template Generator        | 3 pts (Medium)      |
+-------------------+---------------------------------------------------------------+---------------------+
```

---

### `SHD-SKILL-001`: Production Agent Skill Specification (`SKILL.md`)
- **Milestone:** M1
- **Component:** Agent Skill Definition
- **Dependencies:** `SHD-CORE-010`
- **Estimate:** 3 pts
- **Objective:** Author the comprehensive `SKILL.md` file instructing LLM agents on operational guidelines, CLI idioms, and task management standards.
- **Technical Specifications:**
  - Create `skills/shadow/SKILL.md` compliant with Antigravity and Claude Code specifications.
  - Frontmatter triggers: `session start`, `task pivot`, `context switch`, `git branch change`, `blocker`.
  - Explicit operational rules: Always use `--json`, never use interactive prompts, append-only commenting, dual-verification criteria.
- **Acceptance Criteria:**
  - [ ] LLM agent presented with `SKILL.md` creates, updates, and inspects tasks using correct syntax.

---

### `SHD-SKILL-002`: Skill Distribution & Multi-Agent Installation Scripts
- **Milestone:** M1
- **Component:** Agent Tooling Distribution
- **Dependencies:** `SHD-SKILL-001`
- **Estimate:** 2 pts
- **Objective:** Provide a command to install the Shadow skill across supported agent environments.
- **Technical Specifications:**
  - Command: `shadow skill install [--antigravity] [--claude] [--all]`.
  - Targets:
    - Antigravity: `~/.gemini/config/skills/shadow/SKILL.md`
    - Claude Code: `~/.claude/skills/shadow/SKILL.md`
  - Symlink or atomic copy with version validation.
- **Acceptance Criteria:**
  - [ ] Running `shadow skill install --all` places identical valid skill files in all agent directories.

---

### `SHD-SKILL-003`: Agent Idempotency Token Engine & Duplicate Prevention
- **Milestone:** M1
- **Component:** Agent Robustness
- **Dependencies:** `SHD-CORE-006`
- **Estimate:** 3 pts
- **Objective:** Prevent duplicate task creation when AI agents retry turns or experience connection timeouts.
- **Technical Specifications:**
  - Support `--idempotency-key <string>` on `shadow task add`.
  - Fallback: Compute hash `sha256(workspace_id + parent_id + normalize(title) + date_bucket)`.
  - If a matching idempotency record exists within 60 minutes:
    - Return existing task JSON with header `X-Shadow-Deduplicated: true` and exit code `0`.
- **Acceptance Criteria:**
  - [ ] Running `shadow task add "Fix login" --idempotency-key token-123` twice returns the same task ID without inserting a second row.

---

### `SHD-SKILL-004`: Anti-Ghost Work Protocol & Automatic Task Association
- **Milestone:** M1
- **Component:** Agent Behavioral Logic
- **Dependencies:** `SHD-SKILL-001`
- **Estimate:** 3 pts
- **Objective:** Enforce that agents automatically associate code edits with an active task or create a new ad-hoc tracking task before modifying files.
- **Technical Specifications:**
  - Implement `shadow check-active` command returning exit code `0` if a task is active for current branch, or `1` if untracked.
  - Skill rules: Agent must call `shadow check-active` on user prompt. If `1`, invoke `shadow task add "ad-hoc: <prompt>" --start`.
- **Acceptance Criteria:**
  - [ ] Simulated agent session automatically creates an ad-hoc tracking task before editing files.

---

### `SHD-SKILL-005`: Task Pivot & Context Switch Lifecycle Hooks
- **Milestone:** M1
- **Component:** Agent State Machine
- **Dependencies:** `SHD-CORE-006`, `SHD-SKILL-001`
- **Estimate:** 3 pts
- **Objective:** Seamlessly handle mid-session task pivots without leaving stale tasks marked `in_progress`.
- **Technical Specifications:**
  - Command: `shadow task switch <new_task_id> [--pause-reason <text>]`.
  - Transitions previous active task to `blocked` or `todo` with a comment, and sets `<new_task_id>` to `in_progress`.
  - Updates Git branch metadata if moving between branches.
- **Acceptance Criteria:**
  - [ ] Switching tasks marks previous task paused with timestamp comment.
  - [ ] Only one task per worktree is marked `in_progress` at any time.

---

### `SHD-SKILL-006`: Dual-Verification Gatekeeper Engine (`--verify-cmd`)
- **Milestone:** M1
- **Component:** Quality Gate Engine
- **Dependencies:** `SHD-CORE-006`
- **Estimate:** 3 pts
- **Objective:** Prevent agents from closing tasks until automated tests or verification scripts pass cleanly.
- **Technical Specifications:**
  - `shadow task done <id> --verify-cmd "<shell_command>"`.
  - Executes `<shell_command>` in the task's worktree.
  - If exit code != 0:
    - Log stdout/stderr to `task_events`.
    - Set task status to `blocked`.
    - Return exit code `2` with test failure error.
- **Acceptance Criteria:**
  - [ ] Failed verification command blocks task closure and records logs.
  - [ ] Successful verification command transitions task to `done`.

---

### `SHD-SKILL-007`: Markdown Checklist Parser & Completion Validator
- **Milestone:** M1
- **Component:** Checklist Subsystem
- **Dependencies:** `SHD-CORE-006`
- **Estimate:** 3 pts
- **Objective:** Parse `- [ ]` and `- [x]` items in task bodies, track completion ratios, and prevent closure if items are unfinished.
- **Technical Specifications:**
  - Implement `ChecklistParser.extract(markdown: string): ChecklistItem[]`.
  - Add `shadow task checklist <id> [--toggle <index>] [--status]`.
  - If unchecked items remain during `shadow task done`, require `--force` flag or abort.
- **Acceptance Criteria:**
  - [ ] Accurately extracts checklist items from task markdown.
  - [ ] Toggling an item updates the markdown body in SQLite.

---

### `SHD-SKILL-008`: Session Wrap-up & Append-Only Progress Logger
- **Milestone:** M1
- **Component:** Session Continuity
- **Dependencies:** `SHD-SKILL-001`
- **Estimate:** 2 pts
- **Objective:** Ensure end-of-session progress comments record modified files, active blockers, and handoff notes for seamless pickup.
- **Technical Specifications:**
  - Command: `shadow session wrap [--notes <text>] [--git-diff-summary]`.
  - Captures `git status --short`, compiles completed checklist items, and posts event comment to active task.
- **Acceptance Criteria:**
  - [ ] Running wrap-up logs git modified files and remaining checklist items to active task.

---

### `SHD-SKILL-009`: Multi-Process SQLite Concurrency & Jittered Retry Harness
- **Milestone:** M1
- **Component:** Concurrency Testing
- **Dependencies:** `SHD-CORE-003`
- **Estimate:** 5 pts
- **Objective:** Verify and stress-test concurrent multi-subagent execution against the local SQLite database.
- **Technical Specifications:**
  - Build load test script `tests/concurrency_harness.ts`.
  - Spawn 10 worker child processes performing 100 random task operations each (total 1,000 operations) concurrently.
  - Measure transaction latency, retry occurrences, and verify zero unhandled exceptions.
- **Acceptance Criteria:**
  - [ ] 1,000 concurrent operations complete with zero data corruption or unhandled errors.
  - [ ] P99 write latency remains $< 50\text{ms}$ under load.

---

### `SHD-SKILL-010`: Active Task Prompt Injection Helper (`shadow context`)
- **Milestone:** M1
- **Component:** Agent Context
- **Dependencies:** `SHD-CORE-008`
- **Estimate:** 3 pts
- **Objective:** Generate ultra-compact, token-optimized context summaries for injection into agent system prompts.
- **Technical Specifications:**
  - Command: `shadow context [--format prompt|json|compact]`.
  - Output contains: Active task ID, title, unchecked checklist items, git branch, and linked Jira keys.
  - Execution budget: $< 10\text{ms}$.
- **Acceptance Criteria:**
  - [ ] Output uses $< 250$ tokens in prompt format.
  - [ ] Command executes in $< 10\text{ms}$.

---

### `SHD-SKILL-011`: Subagent Task Claiming & Worker Lock Mechanism
- **Milestone:** M1
- **Component:** Multi-Agent Coordination
- **Dependencies:** `SHD-CORE-006`
- **Estimate:** 3 pts
- **Objective:** Prevent two concurrent subagents from working on the same task simultaneously.
- **Technical Specifications:**
  - Add fields `claimed_by: string` and `claimed_at: timestamp` to `tasks`.
  - Command: `shadow task claim <id> --worker-id <string> [--ttl-seconds 300]`.
  - Atomic claim transaction: Fails if already claimed and TTL has not expired.
  - Command: `shadow task release <id> --worker-id <string>`.
- **Acceptance Criteria:**
  - [ ] Second worker attempting to claim an active task is rejected with `TASK_LOCKED`.
  - [ ] Expired claims can be acquired by a new worker.

---

### `SHD-SKILL-012`: Agent Anti-Bloat Output Sanitizer & Exit Code Standards
- **Milestone:** M1
- **Component:** Agent Protocol
- **Dependencies:** `SHD-CORE-010`
- **Estimate:** 2 pts
- **Objective:** Standardize exit codes and ensure agent CLI outputs never include redundant narrative text or unescaped strings.
- **Technical Specifications:**
  - Exit code registry:
    - `0`: Success
    - `1`: Unexpected Internal Error
    - `2`: Validation / Bad Request
    - `3`: Conflict / Lock Error
    - `4`: Verification Failed
  - Ensure `--json` output contains zero extraneous console logs.
- **Acceptance Criteria:**
  - [ ] CLI exit codes match registry across all error conditions.

---

### `SHD-SKILL-013`: Agent Multi-Turn Task Decomposition Template Generator
- **Milestone:** M1
- **Component:** Planning & Decomposition
- **Dependencies:** `SHD-SKILL-001`
- **Estimate:** 3 pts
- **Objective:** Provide CLI scaffolding to generate structured decomposition templates for complex epics.
- **Technical Specifications:**
  - Command: `shadow plan generate <epic_id> [--output template.json]`.
  - Creates a structured JSON planning template with pre-filled parent relationships, spike templates, and verification criteria.
  - Command: `shadow plan apply --file <plan.json>`.
- **Acceptance Criteria:**
  - [ ] `shadow plan apply` atomically creates multiple subtasks and links under the epic in a single transaction.

---

## Milestone 2: Cloudflare Edge Bridge (`shadow-edge`) (14 Tickets)

```
+---------------------------------------------------------------------------------------------------------+
|                                    MILESTONE 2 TICKETS OVERVIEW                                         |
+-------------------+---------------------------------------------------------------+---------------------+
| Ticket ID         | Title                                                         | Estimate (Points)   |
+-------------------+---------------------------------------------------------------+---------------------+
| `SHD-CF-001`      | Cloudflare Worker Scaffold with Hono & Wrangler Environments  | 3 pts (Medium)      |
| `SHD-CF-002`      | Cloudflare D1 Schema Definition with 100% Local Drizzle Parity| 3 pts (Medium)      |
| `SHD-CF-003`      | Cloudflare D1 Additive Migration Pipeline & Miniflare Harness | 3 pts (Medium)      |
| `SHD-CF-004`      | Atlassian OAuth 2.0 3LO Authorization Endpoint Handler        | 3 pts (Medium)      |
| `SHD-CF-005`      | Atlassian OAuth Callback, Token Exchange & Cloudflare KV Nonce| 5 pts (Large)       |
| `SHD-CF-006`      | Distributed Token Refresh Mutex & In-Flight Request Cache     | 5 pts (Large)       |
| `SHD-CF-007`      | Cloudflare Queues Ingestion Worker for Jira Webhooks          | 3 pts (Medium)      |
| `SHD-CF-008`      | Webhook HMAC Verification & Signature Validator               | 3 pts (Medium)      |
| `SHD-CF-009`      | Webhook Event Dispatcher & D1 Mailbox Upsert Consumer         | 5 pts (Large)       |
| `SHD-CF-010`      | Cloudflare Worker API Auth Middleware (Bearer API Keys)       | 3 pts (Medium)      |
| `SHD-CF-011`      | Local CLI `shadow auth login` Interactive Browser Flow        | 3 pts (Medium)      |
| `SHD-CF-012`      | OS Keychain Credential Management (`keytar` / native CLI)     | 3 pts (Medium)      |
| `SHD-CF-013`      | Cloudflare Edge Rate-Limiting & Enterprise WAF Configuration  | 3 pts (Medium)      |
| `SHD-CF-014`      | Staging vs Production CI/CD Deployment Workflow               | 3 pts (Medium)      |
+-------------------+---------------------------------------------------------------+---------------------+
```

---

### `SHD-CF-001`: Cloudflare Worker Scaffold with Hono & Wrangler Environments
- **Milestone:** M2
- **Component:** Cloudflare Workers
- **Dependencies:** `SHD-CORE-001`
- **Estimate:** 3 pts
- **Objective:** Scaffold the `packages/edge` application with Hono web framework and multi-environment Wrangler configuration (`staging` vs `production`).
- **Technical Specifications:**
  - Setup `packages/edge/wrangler.toml` with environments `[env.staging]` and `[env.production]`.
  - Bindings: D1 database, KV namespace, Queue producer/consumer.
  - Implement base Hono app with error handling and request logging.
- **Acceptance Criteria:**
  - [ ] `wrangler dev --env staging` boots local server with functioning `/health` route.

---

### `SHD-CF-002`: Cloudflare D1 Schema Definition with 100% Local Drizzle Parity
- **Milestone:** M2
- **Component:** Cloudflare D1
- **Dependencies:** `SHD-CF-001`, `SHD-CORE-005`
- **Estimate:** 3 pts
- **Objective:** Deploy identical Drizzle ORM schema to Cloudflare D1, ensuring zero data model discrepancies between workstation and edge.
- **Technical Specifications:**
  - Re-export schema definitions from `packages/shared`.
  - D1 database bindings: `SHADOW_EDGE_D1`.
  - Define edge-specific tables: `users`, `api_keys`, `oauth_tokens`, `remote_entity_cache`.
- **Acceptance Criteria:**
  - [ ] Drizzle migrations apply to D1 without SQL syntax errors.
  - [ ] Query builders in Worker TypeScript compile with full type inference.

---

### `SHD-CF-003`: Cloudflare D1 Additive Migration Pipeline & Miniflare Harness
- **Milestone:** M2
- **Component:** Database CI/CD
- **Dependencies:** `SHD-CF-002`
- **Estimate:** 3 pts
- **Objective:** Implement an automated migration validation test suite using Miniflare to ensure zero-downtime additive migrations on D1.
- **Technical Specifications:**
  - Create `tests/d1_migrations.test.ts` running Miniflare D1.
  - Validate that migrations apply sequentially from empty to current version.
  - Enforce rule: All D1 migrations must be additive (no breaking column drops).
- **Acceptance Criteria:**
  - [ ] Migration test passes cleanly in CI against local Miniflare D1.

---

### `SHD-CF-004`: Atlassian OAuth 2.0 3LO Authorization Endpoint Handler
- **Milestone:** M2
- **Component:** OAuth Broker
- **Dependencies:** `SHD-CF-001`
- **Estimate:** 3 pts
- **Objective:** Build `GET /v1/auth/jira/authorize` redirecting users to Atlassian with state nonces and required scopes.
- **Technical Specifications:**
  - Generate cryptographically secure `state` parameter.
  - Store `state` in Cloudflare KV (`KV_SESSIONS`) with 10-minute TTL.
  - Redirect to `https://auth.atlassian.com/authorize` with scopes (`read:jira-work`, `write:jira-work`, `offline_access`).
- **Acceptance Criteria:**
  - [ ] Endpoint generates redirect URL with valid client ID and state parameter.

---

### `SHD-CF-005`: Atlassian OAuth Callback, Token Exchange & Cloudflare KV Nonce
- **Milestone:** M2
- **Component:** OAuth Broker
- **Dependencies:** `SHD-CF-004`
- **Estimate:** 5 pts
- **Objective:** Handle Atlassian OAuth redirect, exchange code for access/refresh tokens, and persist encrypted credentials in D1.
- **Technical Specifications:**
  - `GET /v1/auth/jira/callback`:
    - Verify `state` against KV store.
    - Exchange `code` via `POST https://auth.atlassian.com/oauth/token`.
    - Fetch accessible resources (`GET https://api.atlassian.com/oauth/token/accessible-resources`).
    - Encrypt tokens using AES-GCM-256 with key stored in Cloudflare Secret.
    - Upsert into D1 `oauth_tokens` table.
- **Acceptance Criteria:**
  - [ ] Valid callback exchanges code and saves encrypted tokens.
  - [ ] Tampered state nonce returns `400 Bad Request`.

---

### `SHD-CF-006`: Distributed Token Refresh Mutex & In-Flight Request Cache
- **Milestone:** M2
- **Component:** Token Lifecycle Security
- **Dependencies:** `SHD-CF-005`
- **Estimate:** 5 pts
- **Objective:** Prevent single-use Atlassian refresh token invalidation race conditions by implementing distributed locking and short-term caching in Cloudflare KV.
- **Technical Specifications:**
  - Implement `TokenService.getValidAccessToken(userId: string)`:
    - Check KV cache for active access token.
    - If expired, acquire distributed lock in KV (`lock:refresh:<userId>`) with 15s TTL.
    - Perform refresh exchange with Atlassian.
    - Store new access & refresh tokens in D1 and cache new access token in KV for 55 minutes.
    - Release lock.
- **Acceptance Criteria:**
  - [ ] 5 simultaneous requests for an expired token trigger exactly 1 exchange with Atlassian; all 5 receive the new token.

---

### `SHD-CF-007`: Cloudflare Queues Ingestion Worker for Jira Webhooks
- **Milestone:** M2
- **Component:** Webhook Subsystem
- **Dependencies:** `SHD-CF-001`
- **Estimate:** 3 pts
- **Objective:** Ingest Jira Cloud webhooks at the edge and immediately push them into Cloudflare Queues to guarantee $< 30\text{ms}$ response times.
- **Technical Specifications:**
  - Route: `POST /v1/webhooks/jira`.
  - Push message to queue `JIRA_WEBHOOK_QUEUE`.
  - Return `200 OK` immediately.
- **Acceptance Criteria:**
  - [ ] Webhook request responds with `200 OK` in $< 30\text{ms}$.

---

### `SHD-CF-008`: Webhook HMAC Verification & Signature Validator
- **Milestone:** M2
- **Component:** Webhook Security
- **Dependencies:** `SHD-CF-007`
- **Estimate:** 3 pts
- **Objective:** Cryptographically verify Atlassian webhook HMAC signatures before queue ingestion.
- **Technical Specifications:**
  - Compute SHA-256 HMAC of raw request body using configured webhook secret.
  - Compare computed signature with `X-Hub-Signature` header using timing-safe comparison (`crypto.subtle.timingSafeEqual`).
  - Reject invalid signatures with `401 Unauthorized`.
- **Acceptance Criteria:**
  - [ ] Valid signature proceeds to queue.
  - [ ] Invalid or missing signature returns `401 Unauthorized`.

---

### `SHD-CF-009`: Webhook Event Dispatcher & D1 Mailbox Upsert Consumer
- **Milestone:** M2
- **Component:** Queue Consumer
- **Dependencies:** `SHD-CF-007`, `SHD-CF-002`
- **Estimate:** 5 pts
- **Objective:** Process queued Jira webhook messages, extract issue updates, and update the D1 remote entity cache and user sync mailbox.
- **Technical Specifications:**
  - Implement queue consumer handler in `packages/edge/src/consumers/jira_webhook.ts`.
  - Parse events: `jira:issue_updated`, `comment_created`.
  - Upsert `remote_entity_cache` in D1 with latest title, status, and description.
- **Acceptance Criteria:**
  - [ ] Queued messages are parsed and reflected in D1 `remote_entity_cache`.
  - [ ] Failed queue messages retry with exponential backoff up to 3 attempts.

---

### `SHD-CF-010`: Cloudflare Worker API Auth Middleware (Bearer API Keys)
- **Milestone:** M2
- **Component:** Edge Security
- **Dependencies:** `SHD-CF-001`, `SHD-CF-002`
- **Estimate:** 3 pts
- **Objective:** Authenticate CLI sync requests using high-entropy Bearer API keys.
- **Technical Specifications:**
  - Middleware checks `Authorization: Bearer <token>`.
  - Validate token hash against D1 `api_keys` table.
  - Cache valid token metadata in Cloudflare KV for 15 minutes.
- **Acceptance Criteria:**
  - [ ] Valid token allows request and sets user context.
  - [ ] Missing or invalid token returns `401 Unauthorized`.

---

### `SHD-CF-011`: Local CLI `shadow auth login` Interactive Browser Flow
- **Milestone:** M2
- **Component:** CLI Authentication
- **Dependencies:** `SHD-CF-010`, `SHD-CORE-009`
- **Estimate:** 3 pts
- **Objective:** Implement the terminal pairing flow where `shadow auth login` opens the browser and awaits authorization.
- **Technical Specifications:**
  - CLI creates temporary pairing session code.
  - Opens browser to `https://<edge>/v1/auth/device?code=<pairing_code>`.
  - CLI polls `/v1/auth/device/poll` every 2 seconds until approved (timeout 120s).
  - Receives API key upon completion.
- **Acceptance Criteria:**
  - [ ] Developer logs in via browser and CLI receives valid API key automatically.

---

### `SHD-CF-012`: OS Keychain Credential Management (`keytar` / native CLI)
- **Milestone:** M2
- **Component:** Local Secret Storage
- **Dependencies:** `SHD-CF-011`
- **Estimate:** 3 pts
- **Objective:** Store Cloudflare API keys securely in the macOS Keychain or Linux Secret Service without plain-text configuration files.
- **Technical Specifications:**
  - Service: `shadow-task-tracker`.
  - macOS: `security add-generic-password` / `security find-generic-password`.
  - Linux: `secret-tool` / libsecret.
  - Fallback: AES-256 encrypted file `~/.config/shadow/.credentials` (permissions `0600`).
- **Acceptance Criteria:**
  - [ ] Tokens stored and retrieved cleanly from macOS Keychain.
  - [ ] Zero plain-text credentials in repository or standard config files.

---

### `SHD-CF-013`: Cloudflare Edge Rate-Limiting & Enterprise WAF Configuration
- **Milestone:** M2
- **Component:** Edge Infrastructure
- **Dependencies:** `SHD-CF-001`
- **Estimate:** 3 pts
- **Objective:** Protect Cloudflare Edge Worker from DDoS and rate-limit violations against Jira.
- **Technical Specifications:**
  - Configure rate-limiting rules in `wrangler.toml`: Max 120 requests/minute per API key.
  - Add Cloudflare WAF managed rules for bot protection on public endpoints.
- **Acceptance Criteria:**
  - [ ] Requests exceeding threshold receive `429 Too Many Requests`.

---

### `SHD-CF-014`: Staging vs Production CI/CD Deployment Workflow
- **Milestone:** M2
- **Component:** CI/CD Automation
- **Dependencies:** `SHD-CF-001`
- **Estimate:** 3 pts
- **Objective:** Setup automated GitHub Actions workflows for continuous deployment to Cloudflare staging and production environments.
- **Technical Specifications:**
  - PRs deploy ephemeral preview workers.
  - Merges to `main` apply D1 staging migrations and deploy to staging.
  - Release tags deploy to production with zero downtime.
- **Acceptance Criteria:**
  - [ ] GitHub Actions pipeline successfully tests and deploys worker on pull request.

---

## Milestone 3: $N \leftrightarrow M$ Mapping, Rollup & Jira Sync Engine (13 Tickets)

```
+---------------------------------------------------------------------------------------------------------+
|                                    MILESTONE 3 TICKETS OVERVIEW                                         |
+-------------------+---------------------------------------------------------------+---------------------+
| Ticket ID         | Title                                                         | Estimate (Points)   |
+-------------------+---------------------------------------------------------------+---------------------+
| `SHD-SYNC-001`    | The $N \leftrightarrow M$ Relational Join Table Schema       | 3 pts (Medium)      |
| `SHD-SYNC-002`    | Many-to-One ($N \rightarrow 1$) Task Tree Rollup Generator   | 5 pts (Large)       |
| `SHD-SYNC-003`    | One-to-Many ($1 \rightarrow M$) Multi-Project Fan-Out Resolver| 5 pts (Large)       |
| `SHD-SYNC-004`    | Atlassian Document Format (ADF) AST Generator & Validator     | 5 pts (Large)       |
| `SHD-SYNC-005`    | Dynamic Jira `createmeta` & `editmeta` Introspection Cache    | 5 pts (Large)       |
| `SHD-SYNC-006`    | Interactive & Declarative Jira Mandatory Field Resolver       | 3 pts (Medium)      |
| `SHD-SYNC-007`    | Privacy Firewall: Field Stripper & Tag Redactor               | 3 pts (Medium)      |
| `SHD-SYNC-008`    | Privacy Firewall: Regex Secret & Path Redactor (`--dry-run`)  | 3 pts (Medium)      |
| `SHD-SYNC-009`    | Jira Cloud REST v3 Client with Backoff & Jitter Transport     | 5 pts (Large)       |
| `SHD-SYNC-010`    | Jira Status Transition State Machine Mapping Engine           | 3 pts (Medium)      |
| `SHD-SYNC-011`    | Local Offline Mutation Queue (`sync_queue`) Subsystem         | 5 pts (Large)       |
| `SHD-SYNC-012`    | Bidirectional 3-Way Merge Conflict Resolver (`ours`/`theirs`) | 5 pts (Large)       |
| `SHD-SYNC-013`    | Sync Audit Logging & Tamper-Evident Local History Log         | 3 pts (Medium)      |
+-------------------+---------------------------------------------------------------+---------------------+
```

---

### `SHD-SYNC-001`: The $N \leftrightarrow M$ Relational Join Table Schema
- **Milestone:** M3
- **Component:** Mapping Engine
- **Dependencies:** `SHD-CORE-005`, `SHD-CF-002`
- **Estimate:** 3 pts
- **Objective:** Define and implement the bidirectional mapping table linking local tasks to remote Jira tickets.
- **Technical Specifications:**
  - Table `remote_mappings`:
    - `id`: ULID
    - `local_task_id`: String (FK `tasks.id`)
    - `remote_system`: String (`jira`)
    - `remote_key`: String (e.g. `PROJ-102`)
    - `relation_type`: Enum (`tracks`, `subtask_of`, `blocks`, `relates_to`)
    - `rollup_policy`: JSON blob
  - CLI: `shadow link <local_id> jira:<remote_key>`, `shadow unlink <local_id> jira:<remote_key>`.
- **Acceptance Criteria:**
  - [ ] Bidirectional queries return all local tasks for a Jira key and all Jira keys for a local task.

---

### `SHD-SYNC-002`: Many-to-One ($N \rightarrow 1$) Task Tree Rollup Generator
- **Milestone:** M3
- **Component:** Rollup Engine
- **Dependencies:** `SHD-SYNC-001`
- **Estimate:** 5 pts
- **Objective:** Aggregate $N$ local tasks into a polished markdown status comment and checklist for a single Jira story.
- **Technical Specifications:**
  - Query all local tasks where `remote_key = X`.
  - Synthesize completion percentage, completed checklist items, recent commit SHAs, and active blockers.
  - Format output according to configured rollup template.
- **Acceptance Criteria:**
  - [ ] Generates clean, executive-ready markdown rollup summaries.

---

### `SHD-SYNC-003`: One-to-Many ($1 \rightarrow M$) Multi-Project Fan-Out Resolver
- **Milestone:** M3
- **Component:** Mapping Engine
- **Dependencies:** `SHD-SYNC-001`
- **Estimate:** 5 pts
- **Objective:** Enable a single local epic or architectural task to map across $M$ distinct Jira tickets across different projects.
- **Technical Specifications:**
  - Link resolution determines which subtasks update which remote ticket.
  - Batching updates by remote project.
- **Acceptance Criteria:**
  - [ ] Single local epic updates tickets in 3 separate Jira projects during a single sync operation.

---

### `SHD-SYNC-004`: Atlassian Document Format (ADF) AST Generator & Validator
- **Milestone:** M3
- **Component:** Format Transformation
- **Dependencies:** `SHD-SYNC-002`
- **Estimate:** 5 pts
- **Objective:** Convert standard Markdown into valid Atlassian Document Format JSON schema required by Jira Cloud REST v3.
- **Technical Specifications:**
  - Parse markdown into AST (via unified/remark).
  - Transform AST nodes (headings, paragraphs, code blocks, task lists) to Jira ADF specification.
  - Validate output against official Atlassian JSON schema.
- **Acceptance Criteria:**
  - [ ] Generated ADF payloads validate 100% against Jira REST v3 without formatting rejections.

---

### `SHD-SYNC-005`: Dynamic Jira `createmeta` & `editmeta` Introspection Cache
- **Milestone:** M3
- **Component:** Jira Metadata Engine
- **Dependencies:** `SHD-CF-005`
- **Estimate:** 5 pts
- **Objective:** Dynamically query and cache Jira project metadata and mandatory custom fields to prevent `400 Bad Request` schema mismatches.
- **Technical Specifications:**
  - Fetch `GET /rest/api/3/issue/createmeta?projectKeys=X&expand=projects.issuetypes.fields`.
  - Cache required fields, data types, and allowed options in local table `remote_schema_cache`.
  - Refresh cache weekly or upon remote schema error.
- **Acceptance Criteria:**
  - [ ] Local cache stores all mandatory custom fields for target Jira projects.

---

### `SHD-SYNC-006`: Interactive & Declarative Jira Mandatory Field Resolver
- **Milestone:** M3
- **Component:** Schema Mapping
- **Dependencies:** `SHD-SYNC-005`
- **Estimate:** 3 pts
- **Objective:** Resolve mandatory Jira custom fields via declarative defaults in `shadow.yaml` or interactive CLI prompts.
- **Technical Specifications:**
  - Read `remotes.jira.field_defaults` from `shadow.yaml`.
  - If a mandatory field has no configured default:
    - In human mode: Prompt developer with allowed values.
    - In agent mode: Output structured missing field error.
- **Acceptance Criteria:**
  - [ ] Tickets with mandatory custom fields create and transition without remote rejection.

---

### `SHD-SYNC-007`: Privacy Firewall: Field Stripper & Tag Redactor
- **Milestone:** M3
- **Component:** Privacy Firewall
- **Dependencies:** `SHD-CORE-005`
- **Estimate:** 3 pts
- **Objective:** Ensure tasks marked `is_private: true` or internal fields are never sent upstream.
- **Technical Specifications:**
  - Filter drops all private tasks from sync queue.
  - Strip blacklisted keys: `notes`, `agent_scratchpad`, `stacktrace`.
- **Acceptance Criteria:**
  - [ ] Tasks marked private never leave the workstation.

---

### `SHD-SYNC-008`: Privacy Firewall: Regex Secret & Path Redactor (`--dry-run`)
- **Milestone:** M3
- **Component:** Security Firewall
- **Dependencies:** `SHD-SYNC-007`
- **Estimate:** 3 pts
- **Objective:** Automatically redact secrets, tokens, internal URLs, and local file paths from outbound sync text.
- **Technical Specifications:**
  - Regex patterns for API keys (AWS, GitHub, JWT), IP addresses, and `/Users/username/...` filepaths.
  - Implement `shadow sync --dry-run` displaying a colorized diff of sanitized outbound data.
- **Acceptance Criteria:**
  - [ ] Secrets and absolute user paths are replaced with `[REDACTED]` and `~/...`.
  - [ ] `--dry-run` renders accurate diff without calling remote APIs.

---

### `SHD-SYNC-009`: Jira Cloud REST v3 Client with Backoff & Jitter Transport
- **Milestone:** M3
- **Component:** Jira Transport
- **Dependencies:** `SHD-CF-006`, `SHD-SYNC-004`
- **Estimate:** 5 pts
- **Objective:** Implement the Jira Cloud API client with automatic token attachment, rate-limit retry, and exponential jitter backoff.
- **Technical Specifications:**
  - Route calls through `shadow-edge` or direct with edge Bearer token.
  - Respect `Retry-After` headers on `HTTP 429`.
  - Handle transition endpoints: `GET /rest/api/3/issue/{key}/transitions` and `POST`.
- **Acceptance Criteria:**
  - [ ] Successfully performs CRUD operations and transitions on live Jira Cloud test instances.

---

### `SHD-SYNC-010`: Jira Status Transition State Machine Mapping Engine
- **Milestone:** M3
- **Component:** Workflow Synchronization
- **Dependencies:** `SHD-SYNC-009`
- **Estimate:** 3 pts
- **Objective:** Map local task status transitions to Jira workflow transition IDs.
- **Technical Specifications:**
  - Configuration mapping in `shadow.yaml`:
    ```yaml
    status_matrix:
      in_progress: "In Progress"
      done: "Done"
    ```
  - Discover transition IDs dynamically matching target status names.
- **Acceptance Criteria:**
  - [ ] Marking local task `done` triggers Jira workflow transition to 'Done'.

---

### `SHD-SYNC-011`: Local Offline Mutation Queue (`sync_queue`) Subsystem
- **Milestone:** M3
- **Component:** Offline Engine
- **Dependencies:** `SHD-CORE-003`, `SHD-SYNC-009`
- **Estimate:** 5 pts
- **Objective:** Queue outbound synchronization mutations locally when offline and drain sequentially on reconnect.
- **Technical Specifications:**
  - Table `sync_queue`: `id`, `operation`, `payload`, `attempts`, `status`.
  - Network listener detects connection restoration.
  - `shadow sync`: Drains queue in strict chronological FIFO order.
- **Acceptance Criteria:**
  - [ ] Actions executed while offline are queued and successfully replayed when connectivity returns.

---

### `SHD-SYNC-012`: Bidirectional 3-Way Merge Conflict Resolver (`ours`/`theirs`)
- **Milestone:** M3
- **Component:** Conflict Resolution
- **Dependencies:** `SHD-SYNC-011`
- **Estimate:** 5 pts
- **Objective:** Detect and resolve conflicts when both local developer and remote Jira issue have been modified since last sync.
- **Technical Specifications:**
  - Track `last_synced_hash` and `remote_version`.
  - If remote has changed and local has pending mutations:
    - `--strategy ours`: Local overwrites remote.
    - `--strategy theirs`: Remote overwrites local.
    - Interactive mode: Display 3-way diff picker.
- **Acceptance Criteria:**
  - [ ] Detects conflicting modifications cleanly without data loss.

---

### `SHD-SYNC-013`: Sync Audit Logging & Tamper-Evident Local History Log
- **Milestone:** M3
- **Component:** Compliance & Audit
- **Dependencies:** `SHD-SYNC-011`
- **Estimate:** 3 pts
- **Objective:** Maintain an immutable local audit log of every payload transmitted to remote corporate tooling.
- **Technical Specifications:**
  - Log to `~/.local/share/shadow/audit.log` with timestamp, destination, payload hash, and status.
  - Command: `shadow audit list [--limit 50]`.
- **Acceptance Criteria:**
  - [ ] Every sync event records an immutable entry in the local audit log.

---

## Milestone 4: Developer TUI, Web Viewer & Release Operations (12 Tickets)

```
+---------------------------------------------------------------------------------------------------------+
|                                    MILESTONE 4 TICKETS OVERVIEW                                         |
+-------------------+---------------------------------------------------------------+---------------------+
| Ticket ID         | Title                                                         | Estimate (Points)   |
+-------------------+---------------------------------------------------------------+---------------------+
| `SHD-TUI-001`     | Terminal User Interface (TUI) Canvas & Navigation State Engine| 5 pts (Large)       |
| `SHD-TUI-002`     | TUI Kanban Board View with Drag/Key Status Transitions        | 3 pts (Medium)      |
| `SHD-TUI-003`     | TUI Hierarchy Tree View & Jira Association Inspector          | 3 pts (Medium)      |
| `SHD-TUI-004`     | Git Hook Installer (`pre-push`, `post-commit` non-blocking)   | 2 pts (Small)       |
| `SHD-WEB-001`     | Cloudflare Pages Read-Only Viewer Scaffold (React/Vite)       | 3 pts (Medium)      |
| `SHD-WEB-002`     | Cloudflare D1 Read-Only Edge API for Web Projection           | 3 pts (Medium)      |
| `SHD-WEB-003`     | Cloudflare Zero Trust Access & Shared Token Auth for Web      | 3 pts (Medium)      |
| `SHD-DOCS-001`    | Developer Guide, Architecture Specs & CLI Reference           | 3 pts (Medium)      |
| `SHD-DOCS-002`    | Automated Shell Autocompletion Scripts (zsh, bash, fish)      | 2 pts (Small)       |
| `SHD-REL-001`     | Cross-Platform Standalone Binary Build Pipeline (macOS/Linux) | 3 pts (Medium)      |
| `SHD-REL-002`     | Homebrew Tap Formula & One-Line `curl | sh` Installer         | 3 pts (Medium)      |
| `SHD-QA-001`      | End-to-End Multi-Worktree Multi-Agent Simulation Test Suite   | 5 pts (Large)       |
+-------------------+---------------------------------------------------------------+---------------------+
```

---

### `SHD-TUI-001`: Terminal User Interface (TUI) Canvas & Navigation State Engine
- **Milestone:** M4
- **Component:** Terminal Interface
- **Dependencies:** `SHD-CORE-009`
- **Estimate:** 5 pts
- **Objective:** Build the core TUI application framework with keyboard navigation, resize handlers, and split views.
- **Technical Specifications:**
  - Use React Ink or native terminal renderer compiled into Bun binary.
  - Global hotkeys: `Tab` (switch views), `q` (quit), `?` (help), `s` (sync).
  - Sub-40ms initial render time.
- **Acceptance Criteria:**
  - [ ] `shadow ui` opens interactive TUI cleanly in $< 40\text{ms}$.

---

### `SHD-TUI-002`: TUI Kanban Board View with Drag/Key Status Transitions
- **Milestone:** M4
- **Component:** Terminal Interface
- **Dependencies:** `SHD-TUI-001`
- **Estimate:** 3 pts
- **Objective:** Interactive Kanban board columns (`Todo`, `In Progress`, `Done`) with keyboard task card movement.
- **Technical Specifications:**
  - Keys: `h`/`l` (move columns), `j`/`k` (move cards), `Space` (transition).
  - Immediate local SQLite write on card movement.
- **Acceptance Criteria:**
  - [ ] Moving card transitions status in SQLite immediately and refreshes view.

---

### `SHD-TUI-003`: TUI Hierarchy Tree View & Jira Association Inspector
- **Milestone:** M4
- **Component:** Terminal Interface
- **Dependencies:** `SHD-TUI-001`, `SHD-SYNC-001`
- **Estimate:** 3 pts
- **Objective:** Tree hierarchy view showing nested subtasks, spikes, and linked Jira ticket statuses.
- **Technical Specifications:**
  - Collapsible tree nodes (`Enter` to expand/collapse).
  - Side inspector panel displaying Jira key, remote status, and sync state.
- **Acceptance Criteria:**
  - [ ] Displays multi-level task hierarchy with linked Jira metadata.

---

### `SHD-TUI-004`: Git Hook Installer (`pre-push`, `post-commit` non-blocking)
- **Milestone:** M4
- **Component:** Git Automation
- **Dependencies:** `SHD-SYNC-011`
- **Estimate:** 2 pts
- **Objective:** Automatically install Git hooks that sync tasks on commit and push without blocking developer flow.
- **Technical Specifications:**
  - Command: `shadow hook install`.
  - `post-commit`: Stamps commit SHA into active task event log.
  - `pre-push`: Spawns background process `shadow sync push --quiet &`.
- **Acceptance Criteria:**
  - [ ] Hooks execute without perceptible delay to git commands.

---

### `SHD-WEB-001`: Cloudflare Pages Read-Only Viewer Scaffold (React/Vite)
- **Milestone:** M4
- **Component:** Cloud Web App
- **Dependencies:** `SHD-CF-002`
- **Estimate:** 3 pts
- **Objective:** Build the lightweight, read-only web dashboard on Cloudflare Pages for non-terminal stakeholders.
- **Technical Specifications:**
  - React/Vite application under `packages/web`.
  - Deployed to Cloudflare Pages via GitHub Actions.
  - Kanban and rollup view of synced project tasks.
- **Acceptance Criteria:**
  - [ ] Dashboard loads in $< 500\text{ms}$ globally on Cloudflare edge.

---

### `SHD-WEB-002`: Cloudflare D1 Read-Only Edge API for Web Projection
- **Milestone:** M4
- **Component:** Cloudflare Workers API
- **Dependencies:** `SHD-WEB-001`, `SHD-CF-002`
- **Estimate:** 3 pts
- **Objective:** Provide read-only JSON endpoints on Cloudflare Workers querying D1 for web viewer consumption.
- **Technical Specifications:**
  - `GET /v1/public/projects/:id/summary`.
  - Cache headers: `Cache-Control: public, max-age=60, s-maxage=300`.
- **Acceptance Criteria:**
  - [ ] Serves cached project summaries from edge D1 with $< 25\text{ms}$ response time.

---

### `SHD-WEB-003`: Cloudflare Zero Trust Access & Shared Token Auth for Web
- **Milestone:** M4
- **Component:** Cloud Security
- **Dependencies:** `SHD-WEB-001`
- **Estimate:** 3 pts
- **Objective:** Secure the stakeholder web viewer with Cloudflare Access (SSO/email PIN) or shared read-only view tokens.
- **Technical Specifications:**
  - Support Cloudflare Access JWT header validation (`Cf-Access-Jwt-Assertion`).
  - Optional read-only shareable link tokens generated via CLI (`shadow share project`).
- **Acceptance Criteria:**
  - [ ] Unauthorized access to web viewer is blocked.

---

### `SHD-DOCS-001`: Developer Guide, Architecture Specs & CLI Reference
- **Milestone:** M4
- **Component:** Documentation
- **Dependencies:** `SHD-CORE-009`
- **Estimate:** 3 pts
- **Objective:** Deliver complete developer documentation, architecture guides, and CLI reference.
- **Technical Specifications:**
  - Full rewrite of `README.md` and `INSTALL.md`.
  - Architecture diagrams and command usage examples.
- **Acceptance Criteria:**
  - [ ] New developer successfully onboards and runs first sync in under 5 minutes.

---

### `SHD-DOCS-002`: Automated Shell Autocompletion Scripts (zsh, bash, fish)
- **Milestone:** M4
- **Component:** CLI Ergonomics
- **Dependencies:** `SHD-CORE-009`
- **Estimate:** 2 pts
- **Objective:** Generate shell tab-completion scripts for commands, subcommands, and active task IDs.
- **Technical Specifications:**
  - Command: `shadow completion [zsh|bash|fish]`.
  - Auto-completes task IDs dynamically by querying local SQLite database.
- **Acceptance Criteria:**
  - [ ] Typing `shadow task get SHD-<Tab>` auto-completes active task IDs.

---

### `SHD-REL-001`: Cross-Platform Standalone Binary Build Pipeline (macOS/Linux)
- **Milestone:** M4
- **Component:** Release Engineering
- **Dependencies:** `SHD-CORE-001`
- **Estimate:** 3 pts
- **Objective:** Automate multi-platform compilation of standalone binaries in GitHub Actions.
- **Technical Specifications:**
  - Matrix build in GitHub Actions:
    - `darwin-arm64` (Apple Silicon)
    - `darwin-x64` (Intel Mac)
    - `linux-x64` (Linux x86_64)
    - `linux-arm64` (Linux ARM64)
  - Sign binaries and generate SHA256 checksums.
- **Acceptance Criteria:**
  - [ ] Automated release workflow attaches cross-compiled binaries to GitHub Releases.

---

### `SHD-REL-002`: Homebrew Tap Formula & One-Line `curl | sh` Installer
- **Milestone:** M4
- **Component:** Distribution
- **Dependencies:** `SHD-REL-001`
- **Estimate:** 3 pts
- **Objective:** Provide frictionless installation via Homebrew (`brew install shadow-pm`) and `curl | sh`.
- **Technical Specifications:**
  - Maintain Homebrew formula repository `homebrew-tap`.
  - Create `install.sh` script detecting OS/architecture, downloading binary, and installing to `/usr/local/bin/shadow`.
- **Acceptance Criteria:**
  - [ ] One-line curl command installs and verifies `shadow` in $< 10$ seconds.

---

### `SHD-QA-001`: End-to-End Multi-Worktree Multi-Agent Simulation Test Suite
- **Milestone:** M4
- **Component:** Quality Assurance & Simulation
- **Dependencies:** All previous tickets
- **Estimate:** 5 pts
- **Objective:** Comprehensive automated simulation exercising multi-worktree concurrency, agent decomposition, offline queuing, Cloudflare edge relay, and mock Jira synchronization.
- **Technical Specifications:**
  - Automated test script `tests/full_lifecycle_simulation.ts`:
    1. Spawns 2 separate Git worktrees.
    2. Runs 2 parallel AI subagent sessions in each worktree.
    3. Simulates network disconnection, queues 20 mutations.
    4. Reconnects network, executes `shadow sync`.
    5. Verifies mock Jira received accurate ADF rollups and conflict-free status updates.
- **Acceptance Criteria:**
  - [ ] Full simulation passes in CI with 100% test success and zero data corruption.

---

*End of Granular Engineering Ticket Specifications v2.0.*
