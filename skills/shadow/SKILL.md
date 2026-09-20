---
name: shadow
description: Production local-first issue engine and task execution protocol for AI agents and human developers. Prevents context loss, eliminates untracked ghost work, enforces verification gates, and coordinates parallel agent swarms.
triggers:
  - "session start"
  - "context switch"
  - "task pivot"
  - "blocking issue"
  - "session wrap-up"
  - "pre-commit"
  - "subagent dispatch"
---

# Skill: shadow (v2.0 Hardened Production Specification)

Shadow is an ultra-low latency, local-first issue engine and task tracking protocol designed for AI pair programmers and human engineers. It eliminates untracked ghost work, prevents context loss between development sessions, guarantees idempotency across model retries, and enforces verification gatekeepers before work is closed.

---

## 1. Non-Negotiable Agent Rules (Anti-Ghost Work Protocol)

Whenever starting a development task, feature, bug fix, or refactor:
1. **Never perform untracked ghost work**: Before writing code or modifying files, check for the active task:
   ```bash
   shadow context --json
   ```
2. **Associate or Auto-Provision**: If no task is currently active on the current Git branch, associate with an existing task or auto-provision one:
   ```bash
   shadow task active --auto-create "<Descriptive Task Title>" --priority high
   ```
3. **Idempotent Retries**: When creating tasks programmatically or during retry loops, always provide an `--idempotency-key`:
   ```bash
   shadow task add "Implement auth token rotation" --idempotency-key "agent-turn-${CONVERSATION_ID}-task-1"
   ```
4. **Enforce Dual-Verification Gates**: Never mark a task done without running verification:
   ```bash
   shadow task close <task-id> --verify-cmd "bun test && tsc --noEmit"
   ```
5. **Checklist Completion Guard**: If a task body contains Markdown checklist items (`- [ ]`), all items must be marked `[x]` before closing, or `--force` must be explicitly justified.

---

## 2. Core CLI Command Reference for AI Agents

All commands support `--json` for clean, structured machine consumption.

### 2.1 Context & Task Discovery
| Command | Description |
| :--- | :--- |
| `shadow context --json` | Outputs active workspace, Git branch, active task, parent epic, and uncompleted checklist items. |
| `shadow task active` | Displays or auto-provisions (`--auto-create "<title>"`) the active task for the current branch. |
| `shadow task list --json` | Lists all tasks in the current workspace. Filter with `-s <status>`, `-p <priority>`, `--parent <id>`. |
| `shadow task get <id> --json` | Retrieves complete task details, metadata, and description. |
| `shadow task tree [id]` | Displays recursive hierarchical breakdown tree. |
| `shadow task search "<query>"` | Full-text searches task titles and descriptions via SQLite FTS5. |

### 2.2 Task Mutation & Lifecycle
| Command | Description |
| :--- | :--- |
| `shadow task add "<title>" [flags]` | Creates a new task. Flags: `-d "<desc>"`, `-f <body-file>`, `-p <priority>`, `--parent <id>`, `-s <status>`, `--idempotency-key <key>`. |
| `shadow task edit <id> [flags]` | Updates title (`-t`), description (`-d`/`-f`), priority (`-p`), parent (`--parent`), or status (`-s`). |
| `shadow task close <id> [flags]` | Closes task (`status=done`). Enforces checklist completion and runs `--verify-cmd "<command>"`. Bypass with `--force`. |
| `shadow task pivot <newTaskId>` | Pauses active task (sets to `todo`, logs checkpoint) and sets `<newTaskId>` to `in_progress` on active branch. |
| `shadow task delete <id>` | Permanently deletes task. |

### 2.3 Progress Logging & Checklists
| Command | Description |
| :--- | :--- |
| `shadow task comment <id> "<message>"` | Appends progress update or audit note to task history. (Alias: `shadow task log`). |
| `shadow task history <id> --json` | Retrieves complete chronological event log (creations, edits, comments, verifications). |
| `shadow task checklist <id> [--check <idx>]` | Parses checklist (`- [ ]` vs `- [x]`), calculates completion %, or toggles items. |
| `shadow task decompose <id> -t <template>` | Breaks down a parent task using a template (`feature`, `bugfix`, `refactor`, `research`). |

### 2.4 Subagent Fleet & Multi-Worker Concurrency
| Command | Description |
| :--- | :--- |
| `shadow task claim <id> -w <workerId> [--lease <secs>]` | Acquires exclusive worker lease. Returns exit code 4 on lock collision. |
| `shadow task release <id> -w <workerId>` | Releases worker claim lease. |

### 2.5 Database Health & Disaster Recovery
| Command | Description |
| :--- | :--- |
| `shadow db status --json` | Displays database path, WAL size, integrity check (`ok`), and environment tier. |
| `shadow db backup --json` | Creates atomic online snapshot (`VACUUM INTO`) and prunes backups older than 7 days. |
| `shadow db restore <path>` | Restores database from snapshot. |

---

## 3. Standard Exit Codes

| Code | Name | Description |
| :---: | :--- | :--- |
| `0` | `SUCCESS` | Command executed successfully. |
| `1` | `GENERAL_ERROR` | Syntax error, missing entity, or unhandled exception. |
| `2` | `VALIDATION_FAILED` | Precondition check failed (e.g. uncompleted checklist items, cycle error). |
| `3` | `VERIFICATION_FAILED` | Verification command (`--verify-cmd`) returned non-zero exit code. |
| `4` | `LOCK_COLLISION` | Task is already claimed by another active worker under an active lease. |

---

## 4. Multi-Agent Installation & Distribution

To install the Shadow skill across different AI agent environments:

### Antigravity
```bash
cp skills/shadow/SKILL.md ~/.gemini/config/skills/shadow/SKILL.md
```

### Claude Code
```bash
cp skills/shadow/SKILL.md ~/.claude/skills/shadow/SKILL.md
```

### Cursor
Add reference to `.cursor/rules/shadow.mdc` or `.cursorrules`.

Or run the automated multi-agent installer:
```bash
./scripts/install_skill.sh
```
