# Shadow MVP Strategic Roadmap & Architecture Specification (Hardened v2.0)

**Document Version:** 2.0.0  
**Target Milestone:** Initial Minimum Viable Product (MVP)  
**Execution Lead:** Jacob Miller & Antigravity  
**Stack Alignment:** Local-First TypeScript/Bun CLI Engine + Cloudflare Edge Ecosystem (Workers, D1, Queues, Pages)  

---

## Executive Summary & What Changed in v2.0

Following a comprehensive senior architectural review, the initial 25-ticket roadmap was audited for naive assumptions, production environment contamination risks, and operational blindspots.

### Core Additions in v2.0:
1. **Multi-Environment Isolation & Safe Dogfooding:** Strict separation of `local-dev`, `local-test`, and `local-prod` databases. Prevents engineers developing Shadow *from* corrupting their actual daily personal task tracking database.
2. **Multi-Worktree Concurrency Architecture:** Support for Worktrunk (`wt`) where multiple parallel branches/worktrees operate simultaneously without SQLite locking collisions or cross-branch task bleed.
3. **Atlassian Token Rotation Race-Condition Prevention:** Distributed locking in Cloudflare KV to prevent concurrent CLI/Worker operations from bricking Atlassian refresh tokens (which rotate on single use).
4. **Dynamic Jira Schema & Custom Field Discovery:** Moving away from hardcoded Jira fields to dynamic introspection of `createmeta` and `editmeta` with fallback default resolvers.
5. **Agent Idempotency Engine:** Deterministic deduplication and idempotency keys to prevent LLM agents from creating duplicate tasks during retries or truncated turns.
6. **Disaster Recovery & SQLite Checkpointing:** WAL checkpoint management, automatic SQLite backup snapshots before remote sync, and corruption recovery hooks.
7. **Expanded Granular Backlog:** Decomposed from 25 coarse epics into **64 atomic, shovel-ready engineering tickets** across Milestones M0 through M4.

---

## Section 1: Senior Architectural Review & Blindspot Analysis

A panel of 6 senior specialists convened to stress-test the initial architecture:
1. **Dr. Aris Thorne** — Principal Distributed Systems & Local-First Architect
2. **Kavita Patel** — Principal AI Agent & Tooling Architect
3. **Marcus Vance** — Cloudflare Edge & Serverless Architect
4. **Elena Rostova** — Principal Enterprise Systems & Jira Integration Specialist
5. **Samira Chen** — Staff DevOps & Infrastructure Architect
6. **David Sterling** — Senior Staff Technical Program Manager & Delivery Lead

```
+-----------------------------------------------------------------------------------------+
|                                SENIOR BLINDSPOT AUDIT                                   |
+-----------------------------------------------------------------------------------------+
|  Blindspot 1: Multi-Worktree Concurrency & Local Environment Cross-Contamination       |
|  Blindspot 2: Atlassian OAuth Single-Use Refresh Token Invalidation Race Conditions     |
|  Blindspot 3: Enterprise Jira Dynamic Schema Drift & Mandatory Custom Fields            |
|  Blindspot 4: Cloudflare D1 Zero-Downtime Migration & Staging/Prod Pipeline             |
|  Blindspot 5: AI Agent Turn Retries & Unintended Task Duplication (Idempotency)        |
|  Blindspot 6: Local SQLite Corruption, Crash Recovery & WAL Bloat                       |
+-----------------------------------------------------------------------------------------+
```

---

### Detailed Blindspot Resolutions

#### Blindspot 1: Multi-Worktree Concurrency & Local Dogfooding Contamination
* **The Problem (Samira Chen & Dr. Thorne):** When developing Shadow, engineers run test suites, feature branches, and debug builds. If the local development binary writes to the default database (`~/.local/share/shadow/shadow.db`), a failed unit test or experimental schema migration will corrupt or wipe the developer's real, in-flight personal task database. Furthermore, modern development relies on Git worktrees (`wt`): a developer might have 3 worktrees active (`wt switch feature-auth`, `wt switch fix-cache`, etc.). If task state is naive, tasks will cross-bleed between branches.
* **The Resolution (ADR-002):**
  1. **Strict Tri-Tier Environment Scoping:**
     - `production`: `~/.local/share/shadow/shadow.db` (Standard production CLI usage).
     - `development`: `./.shadow-dev/shadow.db` (Local development when hacking on Shadow).
     - `test`: In-memory SQLite (`:memory:`) or ephemeral temp file cleaned up after test run.
     - Controlled via `SHADOW_ENV` and explicit `--db-path` override flag.
  2. **Worktree Multi-Tenancy & Git Root Hash Binding:**
     - Every task stores a `workspace_id` derived from the canonical Git repository root hash.
     - When inside a worktree, `shadow` automatically scopes listings and active task lookups to the current Git repository root and branch, while retaining the ability to query globally via `--all-workspaces`.
  3. **SQLite WAL Concurrency Tuning:**
     - SQLite `busy_timeout` set to 10,000ms with random exponential backoff jitter (10ms - 250ms).
     - Automatic WAL checkpointing triggered every 1,000 pages (`PRAGMA wal_autocheckpoint = 1000`) and during clean CLI exit.

#### Blindspot 2: Atlassian OAuth Single-Use Refresh Token Invalidation Race Conditions
* **The Problem (Elena Rostova & Marcus Vance):** Atlassian's OAuth 2.0 3LO implementation uses **rotating refresh tokens**. When a refresh token is exchanged for a new access token, the old refresh token is invalidated immediately. If the local CLI issues a sync request while an incoming Cloudflare Worker webhook handler is also refreshing the token, both will present the same old refresh token. One will succeed; the other will receive `400 invalid_grant`, which Atlassian treats as token theft, permanently revoking all tokens for that user!
* **The Resolution (ADR-003):**
  1. **Centralized Token Authority on Cloudflare Workers:**
     - The local CLI *never* directly handles or rotates Atlassian OAuth tokens.
     - All Jira API requests are routed through `shadow-edge` or obtain short-lived scoped Bearer tokens issued by the Cloudflare Worker.
  2. **Distributed Refresh Mutex:**
     - Token refresh operations inside `shadow-edge` acquire an atomic lock in Cloudflare KV (`lock:refresh:<user_id>`) with a 15-second TTL.
     - A 60-second grace-period token cache is maintained in KV: if a concurrent request arrives during rotation, it receives the freshly generated access token from KV rather than attempting a duplicate rotation against Atlassian.

#### Blindspot 3: Enterprise Jira Dynamic Schema Drift & Mandatory Custom Fields
* **The Problem (Elena Rostova):** Enterprise Jira instances are heavily customized. Jira administrators frequently add mandatory custom fields (e.g. `customfield_10024: "Root Cause"`, `customfield_10031: "Component/s"`, or custom approval workflow validators). If Shadow assumes standard Jira fields (`summary`, `description`, `issuetype`), every ticket creation or transition will fail with `400 Bad Request: Field X is required`.
* **The Resolution (ADR-004):**
  1. **Dynamic Schema Introspection:**
     - On project linkage (`shadow link project jira:PROJ`), Shadow queries Jira's `GET /rest/api/3/issue/createmeta?projectKeys=PROJ&expand=projects.issuetypes.fields`.
     - It caches required field metadata, types, and allowed values in the local database (`remote_schema_cache`).
  2. **Interactive & Default Field Resolvers:**
     - The developer can define static default values in `shadow.yaml`:
       ```yaml
       remotes:
         jira:
           field_defaults:
             customfield_10024: { value: "Engineering Improvement" }
             components: [{ name: "Core Infrastructure" }]
       ```
     - If an unmapped mandatory field is encountered during sync, the CLI prompts the user interactively (in human mode) or queues a structured validation request (in agent mode).

#### Blindspot 4: Cloudflare D1 Zero-Downtime Migration & Staging/Prod Pipeline
* **The Problem (Samira Chen & Marcus Vance):** Cloudflare D1 migrations execute directly against edge SQLite instances. If a migration alters a table while an active sync request is processing, it could cause write locks. Furthermore, rolling out edge changes without a staging environment risks breaking all developer CLI instances globally.
* **The Resolution (ADR-005):**
  1. **Dual Cloudflare Environments (`staging` vs `production`):**
     - Managed in `packages/edge/wrangler.toml` via `[env.staging]` and `[env.production]`.
     - Separate D1 database bindings: `shadow-edge-staging-d1` and `shadow-edge-prod-d1`.
     - Separate Queues: `jira-webhooks-staging` and `jira-webhooks-prod`.
  2. **Additive-Only Schema Migrations:**
     - D1 migrations must follow expand-and-contract patterns: columns are added as nullable, code is deployed to read new and write both, and deprecated columns are removed only in subsequent releases.
  3. **Automated Preview Deployments:** GitHub Actions automatically provisions ephemeral preview workers on pull requests using Wrangler.

#### Blindspot 5: AI Agent Turn Retries & Unintended Task Duplication
* **The Problem (Kavita Patel):** LLM agents run in asynchronous tool loops. If an agent executes `shadow task add "Implement auth cache"` and the model's turn times out or gets truncated, the agent's retry logic will rerun the command, creating duplicate tasks.
* **The Resolution (ADR-006):**
  1. **Deterministic Idempotency Keys:**
     - Support `--idempotency-key <string>` on all creation commands (`task add`, `task comment`, `task link`).
     - If no key is provided by an agent, Shadow computes an idempotency hash: `SHA256(workspace_id + parent_id + title + date_bucket)`.
     - If an identical task creation request is received within a 1-hour window, Shadow returns the existing task object with status `200 OK` (deduplicated) rather than inserting a duplicate record.

#### Blindspot 6: Local SQLite Corruption, Crash Recovery & WAL Bloat
* **The Problem (Dr. Thorne):** Laptops crash, run out of battery, or undergo forced reboots. If SQLite WAL mode is not checkpointed regularly, the WAL file (`shadow.db-wal`) can grow to gigabytes, degrading read performance. In worst-case scenarios, power cuts during un-synced writes can leave SQLite in a recovery state.
* **The Resolution (ADR-007):**
  1. **Pre-Sync Atomic Database Snapshots:**
     - Before every push sync operation, Shadow uses SQLite's Online Backup API (`sqlite3_backup`) to snapshot `shadow.db` to `~/.local/share/shadow/backups/shadow_backup_<timestamp>.db`. Backups are pruned to retain the last 7 daily snapshots.
  2. **Automated Integrity Check:**
     - On CLI startup, if an unclean shutdown is detected (e.g. stale lock or dirty flag), the CLI runs `PRAGMA integrity_check`.
     - If corruption is detected, it automatically recovers from the latest valid snapshot and notifies the developer.

---

## Section 2: Architectural Blueprints & System Topologies

### 2.1 Multi-Environment Scoping Diagram

```
+----------------------------------------------------------------------------------------+
|                            MULTI-ENVIRONMENT ISOLATION MATRIX                          |
+----------------------------------------------------------------------------------------+

  ENVIRONMENT: PRODUCTION (End-User Dev Work)
  +------------------------------------------------------------------------------------+
  | Path: ~/.local/share/shadow/shadow.db                                              |
  | Edge: https://edge.shadow.dev (Production Worker + Prod D1)                        |
  | Keyring: shadow-cli-prod-token                                                     |
  +------------------------------------------------------------------------------------+

  ENVIRONMENT: DEVELOPMENT (Developing on Shadow itself)
  +------------------------------------------------------------------------------------+
  | Path: <repo-root>/.shadow-dev/shadow.db (Git-ignored)                              |
  | Edge: http://localhost:8787 or https://staging-edge.shadow.dev                     |
  | Keyring: shadow-cli-dev-token                                                      |
  +------------------------------------------------------------------------------------+

  ENVIRONMENT: TEST (Unit & Integration Tests)
  +------------------------------------------------------------------------------------+
  | Path: :memory: or /tmp/shadow-test-<uuid>.db (Ephemeral)                           |
  | Edge: Mock Service Worker (MSW) or Miniflare In-Memory D1                          |
  | Keyring: Mock In-Memory Keyring                                                    |
  +------------------------------------------------------------------------------------+
```

### 2.2 Cloudflare DevOps & Deployment Pipeline

```
+-----------------------------------------------------------------------------------------+
|                       CLOUDFLARE EDGE CI/CD PIPELINE (GITHUB ACTIONS)                   |
+-----------------------------------------------------------------------------------------+

  [Pull Request Opened]
         |
         v
  [1. Lint, Typecheck & Vitest]
         |
         v
  [2. Miniflare Local D1 Migration Test]
         |
         v
  [3. Ephemeral Cloudflare Preview Deployment] (Wrangler PR Preview Worker)
         |
         v
  [4. E2E Agent & CLI Integration Test against Preview]
         |
         v
  [Merge to Main]
         |
         v
  [5. Deploy to Staging Environment] (D1 Staging Migration -> Worker Staging)
         |
         v
  [6. Smoke Tests & Verification]
         |
         v
  [7. Production Release Gate] (Zero-Downtime D1 Prod Migration -> Worker Prod)
```

---

## Section 3: Phased Milestone Staging (M0 - M4)

```
+-----------------------------------------------------------------------------------------+
|                                    DELIVERY MILESTONES                                  |
+--------------------+-------------------------------------------+------------------------+
| Milestone          | Primary Focus                             | Tickets                |
+--------------------+-------------------------------------------+------------------------+
| **Milestone 0**    | Local Storage, Concurrency & Core CLI     | 12 Granular Tickets    |
| **Milestone 1**    | Agent Skill, Idempotency & Verification   | 13 Granular Tickets    |
| **Milestone 2**    | Cloudflare Edge Relay (D1/Workers/Queues) | 14 Granular Tickets    |
| **Milestone 3**    | N <-> M Mapping, ADF & Jira Sync Engine   | 13 Granular Tickets    |
| **Milestone 4**    | Developer TUI, Web Viewer & Release Ops   | 12 Granular Tickets    |
+--------------------+-------------------------------------------+------------------------+
| **Total**          | **Complete Production MVP**               | **64 Granular Tickets**|
+--------------------+-------------------------------------------+------------------------+
```

---

## Section 4: 64-Ticket Granular Backlog Overview

*(Full technical specifications, data contracts, and acceptance criteria are documented in `TICKETS.md`)*

### Milestone 0: Local Storage, Concurrency & Core CLI (12 Tickets)
- `SHD-CORE-001`: Monorepo Scaffolding & Bun Toolchain Configuration
- `SHD-CORE-002`: Multi-Environment Isolation & Database Path Resolver
- `SHD-CORE-003`: SQLite WAL Configuration, Pragmas & Checkpointing Subsystem
- `SHD-CORE-004`: Embedded SQLite Migrations Engine & Drizzle ORM Setup
- `SHD-CORE-005`: Core Task Table Schema & Recursive Hierarchy Drizzle Models
- `SHD-CORE-006`: Task Service CRUD Operations & Cycle Detection Logic
- `SHD-CORE-007`: SQLite FTS5 Full-Text Search Engine & Query Builder
- `SHD-CORE-008`: Git Context & Worktrunk (`wt`) Workspace ID Binding
- `SHD-CORE-009`: Unified CLI Entrypoint & Argument Parsing Framework
- `SHD-CORE-010`: Dual-Mode Formatter (Human ANSI Tables vs Agent JSON)
- `SHD-CORE-011`: Stdin Stream & Markdown File Ingestion (`--body-file`)
- `SHD-CORE-012`: SQLite Disaster Recovery & Automated Snapshot Backup Engine

### Milestone 1: Agent Skill Protocol, Idempotency & Verification (13 Tickets)
- `SHD-SKILL-001`: Production Agent Skill Specification (`skills/shadow/SKILL.md`)
- `SHD-SKILL-002`: Skill Distribution & Multi-Agent Installation Scripts
- `SHD-SKILL-003`: Agent Idempotency Token Engine & Duplicate Prevention
- `SHD-SKILL-004`: Anti-Ghost Work Protocol & Automatic Task Association
- `SHD-SKILL-005`: Task Pivot & Context Switch Lifecycle Hooks
- `SHD-SKILL-006`: Dual-Verification Gatekeeper Engine (`--verify-cmd`)
- `SHD-SKILL-007`: Markdown Checklist Parser & Completion Validator
- `SHD-SKILL-008`: Session Wrap-up & Append-Only Progress Logger
- `SHD-SKILL-009`: Multi-Process SQLite Concurrency & Jittered Retry Harness
- `SHD-SKILL-010`: Active Task Prompt Injection Helper (`shadow context`)
- `SHD-SKILL-011`: Subagent Task Claiming & Worker Lock Mechanism
- `SHD-SKILL-012`: Agent Anti-Bloat Output Sanitizer & Exit Code Standards
- `SHD-SKILL-013`: Agent Multi-Turn Task Decomposition Template Generator

### Milestone 2: Cloudflare Edge Bridge (`shadow-edge`) (14 Tickets)
- `SHD-CF-001`: Cloudflare Worker Scaffold with Hono & Wrangler Environments
- `SHD-CF-002`: Cloudflare D1 Schema Definition with 100% Local Drizzle Parity
- `SHD-CF-003`: Cloudflare D1 Additive Migration Pipeline & Miniflare Harness
- `SHD-CF-004`: Atlassian OAuth 2.0 3LO Authorization Endpoint Handler
- `SHD-CF-005`: Atlassian OAuth Callback, Token Exchange & Cloudflare KV Nonce
- `SHD-CF-006`: Distributed Token Refresh Mutex & In-Flight Request Cache
- `SHD-CF-007`: Cloudflare Queues Ingestion Worker for Jira Webhooks
- `SHD-CF-008`: Webhook HMAC Verification & Signature Validator
- `SHD-CF-009`: Webhook Event Dispatcher & D1 Mailbox Upsert Consumer
- `SHD-CF-010`: Cloudflare Worker API Authentication Middleware (Bearer API Keys)
- `SHD-CF-011`: Local CLI `shadow auth login` Interactive Browser Pairing Flow
- `SHD-CF-012`: OS Keychain Credential Management (`keytar` / native CLI wrapper)
- `SHD-CF-013`: Cloudflare Edge Rate-Limiting & Enterprise WAF Configuration
- `SHD-CF-014`: Staging vs Production CI/CD Deployment Workflow (GitHub Actions)

### Milestone 3: $N \leftrightarrow M$ Mapping, Rollup & Jira Sync Engine (13 Tickets)
- `SHD-SYNC-001`: The $N \leftrightarrow M$ Relational Join Table Schema & Operations
- `SHD-SYNC-002`: Many-to-One ($N \rightarrow 1$) Task Tree Rollup Generator
- `SHD-SYNC-003`: One-to-Many ($1 \rightarrow M$) Multi-Project Fan-Out Resolver
- `SHD-SYNC-004`: Atlassian Document Format (ADF) AST Generator & Validator
- `SHD-SYNC-005`: Dynamic Jira `createmeta` & `editmeta` Introspection Cache
- `SHD-SYNC-006`: Interactive & Declarative Jira Mandatory Field Fallback Resolver
- `SHD-SYNC-007`: Privacy Firewall: Field Stripper & Tag Redactor
- `SHD-SYNC-008`: Privacy Firewall: Regex Secret & Path Redactor with `--dry-run`
- `SHD-SYNC-009`: Jira Cloud REST v3 Client with Backoff & Jitter Transport
- `SHD-SYNC-010`: Jira Status Transition State Machine Mapping Engine
- `SHD-SYNC-011`: Local Offline Mutation Queue (`sync_queue`) Subsystem
- `SHD-SYNC-012`: Bidirectional 3-Way Merge Conflict Resolver (`ours`/`theirs`)
- `SHD-SYNC-013`: Sync Audit Logging & Tamper-Evident Local History Log

### Milestone 4: Developer TUI, Web Viewer & Release Operations (12 Tickets)
- `SHD-TUI-001`: Terminal User Interface (TUI) Canvas & Navigation State Engine
- `SHD-TUI-002`: TUI Kanban Board View with Drag/Key Status Transitions
- `SHD-TUI-003`: TUI Hierarchy Tree View & Jira Association Inspector
- `SHD-TUI-004`: Git Hook Installer (`pre-push`, `post-commit` non-blocking sync)
- `SHD-WEB-001`: Cloudflare Pages Read-Only Viewer Scaffold (React/Vite)
- `SHD-WEB-002`: Cloudflare D1 Read-Only Edge API for Web Projection
- `SHD-WEB-003`: Cloudflare Zero Trust Access & Shared Token Auth for Web Viewer
- `SHD-DOCS-001`: Developer Guide, Architecture Specs & CLI Reference
- `SHD-DOCS-002`: Automated Shell Autocompletion Scripts (zsh, bash, fish)
- `SHD-REL-001`: Cross-Platform Standalone Binary Build Pipeline (macOS/Linux)
- `SHD-REL-002`: Homebrew Tap Formula & One-Line `curl | sh` Installer
- `SHD-QA-001`: End-to-End Multi-Worktree Multi-Agent Simulation Test Suite

---

*End of Strategic Roadmap v2.0.*
