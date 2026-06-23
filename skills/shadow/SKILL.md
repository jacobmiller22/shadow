---
name: shadow
description: Proactively manage the user's personal task backlog in their private GitHub repository to prevent cognitive overload.
triggers:
  - "context switch"
  - "task pivot"
  - "blocking issue"
  - "session wrap-up"
  - "git branch change"
---

# Skill: shadow 👤

Defines the protocol for proactively managing the user's personal task backlog in their private GitHub repository to prevent cognitive overload during context switches.

## Core Capabilities

1. **Ingest & Classify**: Listen to the user's stream of thought, code changes, or explicit mentions, and automatically categorize tasks.
2. **Contextual Search**: Before creating an issue, search the repository to see if a tracking issue already exists.
3. **Proactive Updates & Commenting**: Update issues with progress, code snippets, or blocked statuses without requiring explicit user commands.
4. **Task Lifecycle Management**: Close completed tasks, reopen tasks when resumed, and dynamically manage labels (e.g. marking/unmarking blockers).
5. **State & Context Retrieval**:
   - List active issues or view the full discussion history of a specific task.
   - Look up project-specific context (local repository paths, design docs, notes) stored within the backlog repository to bootstrap execution.

---

## Operational Lifecycle Guidelines

The shadow skill should be loaded at the start and end of every conversation, and during conversations when it appears that an item of work or as soon as meaningful progress has been made, repeating until the conversation is closed.
At these points, you must:
1. **Load and read the global skill**: Load the skill at `~/.gemini/config/skills/shadow/SKILL.md`.
2. **Create/update tasks asynchronously**: Silently initialize, synchronize, and update task states asynchronously in the background (using a relevant subagent to document with "shadow") without requesting user permission or confirmation.

---

## Agent Integration Details

### Claude Code Integration
- **Installation**: Install this skill locally by running `/plugin add --path ./skills/shadow` from the `shadow` repository root, or from a remote URL.
- **Invocation**: Triggered manually using `/shadow` or automatically when trigger conditions (such as switching tasks, git branches, or declaring a blocker) are met.

### Antigravity Integration
- **Installation**: Copy this file to `~/.gemini/config/skills/shadow/SKILL.md` to install it globally.
- **Execution**: Once installed globally or loaded in a workspace session via `view_file` with `IsSkillFile: true`, Antigravity acts as a shadow agent, proactively monitoring conversation events and task states, executing the CLI bindings defined in the configuration, and managing issue lifecycles.

---

## Project-Specific Context Folders

To maintain flexible, reusable context for each project without cluttering issue descriptions, project information is stored in directories at the root of the task backlog repository:

```
shadowtracker/
└── projects/
    └── <project_name>/
        ├── README.md       # Project details, local path, and references
        ├── architecture.md # Architecture notes (optional)
        └── notes.md        # Commands, snippets, troubleshooting (optional)
```

### Main Project Config (`projects/<project_name>/README.md`)
The main markdown file for each project must contain YAML frontmatter at the very top:
```markdown
---
local_path: /Users/jacobmiller22/projects/shadow
docs_url: https://github.com/jacobmiller22/shadow/wiki
---
```

When executing tasks labeled with `project: <project_name>`, the agent should:
1. Locate `projects/<project_name>/README.md` inside the local repository path specified by `local_backlog_path` in the configuration.
2. Parse the frontmatter to find the absolute local path (`local_path`) and reference documentation (`docs_url`).
3. Read additional markdown files in the folder to understand the project architecture and commands.
4. Navigate to the local path and use the retrieved documentation to execute tasks.

---

## Configuration Lookup

The agent should lookup the configuration file at `~/.config/shadow/config.json`.

- If the configuration file exists, the agent should read its settings to determine:
  - The target repository (exact HTTPS or SSH URL).
  - The absolute path to the local backlog repository clone (`local_backlog_path`).
  - The bindings for creating, searching, and updating issues.
- **Executing Bindings**: The bindings do not need to refer to explicit shell CLI commands; they can refer to custom skills, tool paths, or abstract identifiers. The agent should make a best guess based on the format of the configured value:
  - If it resembles a shell command (e.g., starts with `gh` or standard binaries), execute it as a terminal command.
  - If it resembles a custom skill path or tool identifier (e.g., `corp.tools.github.create_issue`), invoke the matching tool/skill in the local environment.

---

## Metadata & Labeling Schema

Every issue created must contain the following structured metadata block at the top of the body, along with appropriate labels:

### Required & Custom Labels

By default, the following standard labels are used by shadow to categorize tasks:
- `type:jira-shadow`: For tracking work mirroring an official Jira story.
- `type:ad-hoc`: Unplanned tasks, requests from teammates, Slack drive-bys, quick bug fixes.
- `type:personal-dev`: Upskilling, reading docs, architecture research, side projects.
- `type:blocker`: Dependencies holding up progress.
- `type:in-progress`: For tasks currently active/in progress.
- `project:<project_name>`: Categorizes the issue under a specific project folder.

#### Custom Label Configuration
To accommodate external project boards governed by specific labels, the user can define label overrides in the configuration file (`~/.config/shadow/config.json`) under the optional `"custom_labels"` object:

```json
  "custom_labels": {
    "type:jira-shadow": "story",
    "type:ad-hoc": "chore",
    "type:personal-dev": "upskill",
    "type:blocker": "blocked",
    "type:in-progress": "in-progress"
  }
```

When creating or managing issues, you must resolve the labels using this configuration:
1. Load `~/.config/shadow/config.json` and check for `"custom_labels"`.
2. Map any standard required labels (like `type:ad-hoc`) to the user's custom label string (like `chore`) if mapped.
3. Fall back to the default standard label if the key is missing from `"custom_labels"` or if `"custom_labels"` is not configured.
4. If project-level custom labels are specified in the project's config file (e.g. `projects/<project_name>/README.md` under a `labels` frontmatter tag), also apply those labels.

### Metadata Block Template

```markdown
---
project: [e.g., shadow]
origin_source: [e.g., Jira-1234, Slack Thread, Self]
deadline: [YYYY-MM-DD or None]
status: [In Progress / Blocked / Completed]
context_tags: [e.g., #frontend, #auth, #ci-cd]
---
```

---

## 📋 Strict Issue Body Formatting

The main body of every created issue must follow this exact markdown layout structure:

```markdown
# Description
[High-level summary of the task, objective, and acceptance criteria]

# Scope & Checklist
- [ ] Task 1
- [ ] Task 2

# References
- [Source URL 1]
- [Source URL 2]

# Technical Context
- **Active Branch**: [branch name or None]
- **Modified Files**: [list of files or None]
- **Environment**: [development/staging/production]
```

## 🔗 Link Autopopulation & Sanitization Rules

To ensure issues are fully traceable, you must actively parse conversation context, git history, branch names, and command outputs to discover references:
1. **Extract and format links**: Gather all relevant URLs such as:
   - **Jira tickets**: e.g., `https://jira.company.com/browse/PROJ-123`
   - **GitHub commits/PRs**: e.g., `https://github.com/...`
   - **CI runs**: e.g., GitHub Actions, Jenkins, CircleCI pipeline logs
   - **Documents**: Google Docs, Wiki links, diagrams
2. **URL Sanitization**:
   - Trim trailing punctuation like `.`, `,`, `)`, `]`, `>` from the extracted URL.
   - Validate that the URL matches a valid scheme (must start with `http://` or `https://`).
   - De-duplicate identical URLs to keep the `# References` list clean and readable.
3. **Support Multiple Links**: Do not limit reference links to just one per source. List all related links under the `# References` section of the issue description or in subsequent comments.

---

## 📝 Commenting, Body Sync & Anti-Bloat Protocols

1. **The No-Duplicate Rule**: Before creating a new issue, search both open and closed issues in the backlog repository using the configured `search_issue` binding. If a tracking issue already exists for the context or task at hand, **reopen and/or update** it rather than creating a duplicate.
2. **The Append-Only History Rule**: Intermediate updates, debug logs, files modified, and successful CLI command outputs must be appended to the issue as **comments** rather than editing the main issue description. This maintains a clear audit trail of progress.
3. **Issue Body & Checklist Synchronization**:
   - When a task is actively being worked on, resumed, or progresses, the agent **must** immediately update the main issue description body itself to ensure the metadata frontmatter `status` is explicitly set to `In Progress` (especially if it was previously `Blocked` or if the task is being resumed/reopened).
   - In addition to updating the body status, the agent **must** ensure that the `type:in-progress` label (resolved via `"custom_labels"` configuration if present) is actively added to the issue (using the `add_label` binding) during active development, task pivots, or task resumptions.
   - When a task completes, becomes blocked, or is paused (e.g., during session wrap-up or blocker registration), the agent **must** immediately remove the `type:in-progress` label (using the `remove_label` binding).
   - The agent **must** update the main issue description body itself using the `update_issue_body` or `update_issue_body_file` binding to keep the frontmatter `status` (e.g., `status: In Progress`, `status: Completed`) and the `# Scope & Checklist` checkboxes (e.g., `- [x] Task 1`) fully in sync with the task's actual state during and at the end of iterations.
4. **Command & Log Filtering**:
   - Do **not** log read-only or trivial/informational shell commands (e.g., `git diff`, `git status`, `git branch`, `git log`, `ls`, `pwd`, `cat`, `which`, `gh auth status`, `gh issue list`) in comments.
   - Only log state-modifying or validating commands (e.g., `git commit`, `git push`, build commands, test runs, or script executions).
5. **Comment Cleanliness & Anti-Bloat**:
   - Issue comments **must never** contain YAML frontmatter blocks. Frontmatter is strictly reserved for the top of the main issue description.
   - At task completion/closure, do **not** post redundant progress comments and closure comments back-to-back. Instead, consolidate them: either update the main body checklist to complete and close the issue with a single descriptive closure comment, or close silently without a duplicate closure comment if a detailed summary comment has just been posted.
   - Avoid posting automated "Still in progress" comments during routine start-of-session checks unless new files were modified or state changes occurred.

---

## 🛡️ Premature Close Prevention & Safety

To prevent losing context on incomplete or broken work:
1. **Do Not Close on Failure**: Never close an issue if unit tests are failing, the build/compilation is broken, blockers remain unresolved, or subtasks in the checklist are incomplete.
2. **State Tracking**: If work stops but is incomplete or broken, transition the status to `Blocked` or keep it `In Progress` (and when returning to or resuming the task, immediately update the metadata `status` to `In Progress` in the main issue body and apply the `type:in-progress` label). If the task is blocked, ensure the `type:in-progress` label is removed and the `type:blocker` label is added. Add a comment specifying the failure logs and files modified.
3. **Dual-Verification Closure Criteria**: Only close an issue when:
   - All checklist items in the main issue description are updated, checked (`[x]`), and completed.
   - Unit tests are verified green.
   - **Runtime verification** is performed (e.g., executing the service, verifying log outputs for the feature) OR the user explicitly signals task completion / accepts the judgment.

---

## 💾 Local Scratch Drafting Flow (Concurrency Support)

To support multiple agent instances running concurrently without filename collisions:
1. **Generate Unique Filename**: Before executing the GitHub CLI binding to create or update an issue, write the payload to a draft file under `~/.local/share/shadow/`. The filename must use a task-relevant unique identifier: `scratch_<ISO8601-timestamp>_<task_slug>.md` where `<task_slug>` is a short, lowercase snake_case or kebab-case phrase derived from the task title or description (e.g. `scratch_20260623T024000Z_fix_expired_staging_auth_token.md`).
2. **Upload/Binding Execution**: Run the resolved issue tracking binding (e.g., `gh issue create`, `gh issue comment`, or body editing/updating via `update_issue_body_file`) passing the contents of the unique scratch file.
3. **Draft Cleanup**: Upon successful creation/update, immediately delete the scratch markdown file.

---

## 🔄 Git Reconciliation Routine

To prevent git push locks and merge conflicts in multi-workspace backlog repositories:
1. **Pre-push Rebase**: Always run `git pull --rebase` inside the backlog repository before executing any commit or push.
2. **Exponential Backoff**: In case of push rejection or remote ref locking, sleep for a short duration and retry up to 3 times with exponential backoff (e.g., 1s, 2s, 4s).
3. **Conflict Resolution**: If git conflicts cannot be resolved automatically, dump the conflicting file contents to the dedicated scratch folder (`~/.local/share/shadow/`) and request manual resolution from the user.

---

## 📶 Offline Mode & Local Queuing

To ensure task tracking states are preserved during offline mode, timeouts, or GitHub CLI/API failures:
1. **Detect Network Failures**: If any binding command fails with a non-zero exit code due to socket timeouts, DNS resolution failures, or API rate limits, catch the error.
2. **Queue Payload**: Move/rename the scratch file from `~/.local/share/shadow/scratch_*.md` to `~/.config/shadow/queue/queue_<timestamp>_<id>.md`.
3. **Start-of-Session Processing**: At the start of every session/task, check `~/.config/shadow/queue/` for any cached payloads.
4. **FIFO Re-synchronization**: If connectivity is restored (e.g., `gh auth status` passes or a ping succeeds), process all queue files chronologically (First-In, First-Out) using the appropriate bindings, then delete the queued files.

---

## 🐞 Configuration Failbacks & Error Recovery

To prevent agent crashes due to configuration faults:
1. **Validation & Recovery**: If the configuration file `~/.config/shadow/config.json` is missing or contains malformed JSON:
   - Fall back to vanilla CLI commands directly (e.g., standard `gh issue create`, `gh issue comment`).
   - Fall back to standard default labels (e.g., `type:ad-hoc`, `project:<name>`) if label mappings are corrupt.
2. **Error Logging**: Log configuration parsing warnings or command failures to the local log file `~/.config/shadow/error.log` instead of breaking execution.

