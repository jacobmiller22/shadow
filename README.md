# Shadow ⚡ 👤

**Ultra-low latency, local-first issue engine & Cloudflare Edge sync ecosystem for AI agents and human developers.**

[![CI](https://github.com/jacobmiller22/shadow/actions/workflows/release.yml/badge.svg)](https://github.com/jacobmiller22/shadow/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun%201.4-black.svg)](https://bun.sh)

Shadow eliminates cognitive overhead, untracked "ghost work", and context loss during high-velocity development. It combines an embedded SQLite WAL database ($< 20\text{ms}$ latency), strict Git worktree concurrency isolation, deterministic agent idempotency deduplication, and a distributed Cloudflare Edge synchronization bridge to corporate Jira instances.

---

## Key Features

- 🏎️ **Ultra-Fast Local SQLite Engine:** Sub-20ms CLI response times with FTS5 Porter-tokenized full-text search, DFS hierarchy cycle detection, and automated WAL checkpointing.
- 🌳 **Worktrunk (`wt`) Multi-Worktree Isolation:** Automatically binds task state to Git repository root hashes and active branches. Prevents task cross-bleed between parallel feature branches.
- 🤖 **Agent Skill Protocol & Idempotency:** Universal agent integration for Antigravity, Claude Code, and Cursor. Built-in `SHA256(workspace:parent:title:hour)` deterministic deduplication prevents duplicate tasks on agent turn retries.
- 🔒 **Worker Claim Locks & Concurrency:** Leases and mutexes prevent collision between parallel subagent swarms executing simultaneous mutations.
- 🛡️ **Dual-Verification Closure Gates:** Enforces automated verification commands (`--verify-cmd`) and markdown checklist validation before tasks can be closed.
- ☁️ **Cloudflare Edge Bridge (`shadow-edge`):** Serverless bridge with Hono, Cloudflare D1, Queues, KV, and Distributed OAuth Refresh Mutex (ADR-003) to eliminate Atlassian token rotation race conditions.
- 🔄 **$N \leftrightarrow M$ Jira Sync Engine:** Bidirectional Atlassian Document Format (ADF v3) AST parser, dynamic Jira `createmeta` schema introspection, task tree rollups, multi-project fan-out, and 3-way conflict resolution.
- 🔐 **Privacy Firewall:** Drops tasks marked private (`#private`, `is_private: true`), strips internal metadata, and redacts secrets (AWS, GitHub, JWT tokens) and local user home paths from outbound sync.
- 💻 **Interactive Terminal UI (`shadow ui`):** Full-screen terminal canvas with interactive Kanban board, hierarchy tree viewer, and task inspector.
- 🌐 **Cloudflare Pages Web Dashboard:** Real-time stakeholder progress viewer with KPIs, live Kanban board, and Zero Trust access protection.

---

## Architecture Overview

```
                                  LOCAL WORKSTATION
  +-------------------------------------------------------------------------------+
  |  AI Agents (Antigravity / Claude Code)          Developer (CLI / TUI)          |
  |         \                                                /                     |
  |          \---------->  bin/shadow CLI & TUI  <----------/                      |
  |                                 |                                              |
  |             Local-First SQLite Engine (WAL mode, <20ms)                        |
  |        [tasks]  [events]  [remote_links]  [sync_queue]  [audit_log]            |
  +---------------------------------|---------------------------------------------+
                                    | (Background push / pull)
                                    v
  +-------------------------------------------------------------------------------+
  |                      CLOUDFLARE EDGE BRIDGE (shadow-edge)                     |
  |                                                                               |
  |   Cloudflare Workers (Hono)  +  Cloudflare D1 SQL  +  Distributed Token Mutex |
  |   Endpoints: /v1/sync/push, /v1/sync/pull, /v1/web/tasks, /v1/auth/jira       |
  +---------------------------------|---------------------------------------------+
                                    | (OAuth 2.0 3LO REST v3)
                                    v
  +-------------------------------------------------------------------------------+
  |                      ENTERPRISE SYSTEMS (Jira Cloud REST v3)                  |
  |               Epics, Stories, Subtasks, Dynamic Custom Fields                 |
  +-------------------------------------------------------------------------------+
```

---

## Quick Start

### 1. Installation
```bash
# One-line install to ~/.local/bin/shadow
curl -fsSL https://raw.githubusercontent.com/jacobmiller22/shadow/main/install.sh | bash
```

### 2. Basic Commands
```bash
# Add a new task
shadow task add "Implement auth token refresh" -p high

# List tasks in current workspace
shadow task list

# Start and claim a task for an agent
shadow task claim SHD-0001 --worker agent-1

# Launch the interactive Terminal UI
shadow ui

# Link to Jira ticket
shadow link SHD-0001 jira:PROJ-1024

# Preview outbound sanitized diff
shadow sync --dry-run

# Run sync
shadow sync
```

---

## CLI Command Reference

### `shadow task`
| Command | Description |
| :--- | :--- |
| `task add <title>` | Create a new task (supports `--priority`, `--parent`, `--idempotency-key`) |
| `task get <id>` | Retrieve full task detail, checklists, and remote links |
| `task active` | Show or auto-provision active in-progress task |
| `task pivot <id>` | Pause current task and activate new target task |
| `task list` | List tasks in workspace (supports `--status`, `--json`, `--all-workspaces`) |
| `task edit <id>` | Modify title, description, priority, or status |
| `task close <id>` | Mark task as done with `--verify-cmd "<cmd>"` verification gate |
| `task checklist <id>` | View or toggle markdown checklist items (`--check <idx>`) |
| `task comment <id>` | Append progress note to task audit log |
| `task claim <id>` | Acquire worker mutex lease lock (`--worker <id> --lease <sec>`) |
| `task decompose <id>` | Decompose task using templates (`feature`, `bugfix`, `refactor`) |
| `task search <query>` | Sub-10ms full-text keyword search via SQLite FTS5 |
| `task tree` | Render hierarchical tree of tasks and subtasks |

### `shadow ui`
Opens the interactive terminal user interface with keyboard navigation:
- `Tab`: Cycle between Kanban Board, Hierarchy Tree, and Task Inspector
- `h` / `l` or `←` / `→`: Navigate columns
- `j` / `k` or `↓` / `↑`: Select card
- `Space` / `Enter`: Advance task status (`Todo` $\rightarrow$ `In Progress` $\rightarrow$ `Done`)
- `?`: Toggle keyboard shortcuts overlay
- `q`: Exit cleanly

### `shadow sync` & `shadow link`
- `shadow link <id> <system:key>`: Bidirectional link to Jira or GitHub issue.
- `shadow sync --dry-run`: Previews sanitized outbound payload after privacy redaction.
- `shadow sync --strategy ours|theirs`: Resolves 3-way synchronization conflicts.
- `shadow audit`: Inspects tamper-evident SHA256 audit log of all remote transmissions.

### `shadow hook`
- `shadow hook install`: Installs non-blocking `post-commit` (audits commits to active task) and `pre-push` (background sync) Git hooks.

---

## Multi-Environment Dogfooding Isolation

Shadow guarantees that developing or testing Shadow itself never contaminates your real task database:

| Environment | Database Path | Keyring / Edge |
| :--- | :--- | :--- |
| **`production`** | `~/.local/share/shadow/shadow.db` | Production Edge (`https://edge.shadow.dev`) |
| **`development`** | `<repo-root>/.shadow-dev/shadow.db` | Staging Edge / Localhost (`:8787`) |
| **`test`** | In-Memory (`:memory:`) or ephemeral temp | Mock Service Worker / Miniflare |

---

## Monorepo Packages

- **`packages/shared`**: SQLite engine, Drizzle ORM schemas, FTS5 search, Task CRUD, Jira ADF parser, Privacy firewall, and Sync queue.
- **`packages/cli`**: Standalone compiled binary, Commander CLI hierarchy, Terminal UI, formatters, and Git hook manager.
- **`packages/edge`**: Cloudflare Workers bridge, Cloudflare D1 SQL schemas, OAuth token mutex, webhook ingestion queue, and web projection API.
- **`packages/web`**: Cloudflare Pages read-only stakeholder progress dashboard.

---

## License

MIT © Jacob Miller
