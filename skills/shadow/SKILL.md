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

At the start, periodically between, and at the end of completing tasks, you must:
1. **Always leverage a relevant subagent to document with "shadow"**: Use a background subagent (e.g., `research` or a subagent loaded with the `shadow` skill) to execute task-tracking operations.
2. **Make sure the relevant issue is created/updated at every stage**: Ensure issues are created or commented on at the start of a task, as updates occur, and upon task completion.
3. **Execute silently and asynchronously**: All updates via `shadow` should not request permission or confirmation from the user, and should always run asynchronously in the background.

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
- `project:<project_name>`: Categorizes the issue under a specific project folder.

#### Custom Label Configuration
To accommodate external project boards governed by specific labels, the user can define label overrides in the configuration file (`~/.config/shadow/config.json`) under the optional `"custom_labels"` object:

```json
  "custom_labels": {
    "type:jira-shadow": "story",
    "type:ad-hoc": "chore",
    "type:personal-dev": "upskill",
    "type:blocker": "blocked"
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

## 📝 Commenting & Anti-Duplication Protocols

1. **The No-Duplicate Rule**: Before creating a new issue, search both open and closed issues in the backlog repository using the configured `search_issue` binding. If a tracking issue already exists for the context or task at hand, **reopen and/or update** it rather than creating a duplicate.
2. **The Append-Only History Rule**: Intermediate updates, debug logs, files modified, and successful CLI command outputs must be appended to the issue as **comments** rather than editing the main issue description. This maintains a clear audit trail of progress.

---

## 🛡️ Premature Close Prevention & Safety

To prevent losing context on incomplete or broken work:
1. **Do Not Close on Failure**: Never close an issue if unit tests are failing, the build/compilation is broken, blockers remain unresolved, or subtasks in the checklist are incomplete.
2. **State Tracking**: If work stops but is incomplete or broken, transition the status to `Blocked` or keep it `In Progress`. Add a comment specifying the failure logs and files modified.
3. **Dual-Verification Closure Criteria**: Only close an issue when:
   - All checklist items are checked and completed.
   - Unit tests are verified green.
   - **Runtime verification** is performed (e.g., executing the service, verifying log outputs for the feature) OR the user explicitly signals task completion / accepts the judgment.

---

## 💾 Local Scratch Drafting Flow (Concurrency Support)

To support multiple agent instances running concurrently without filename collisions:
1. **Generate Unique Filename**: Before executing the GitHub CLI binding to create or update an issue, write the payload to a draft file under `~/.config/shadow/scratch/`. The filename must use a standardized high-entropy, unique identifier: `scratch_<ISO8601-timestamp>_<UUIDv4_or_16_char_hex>.md` (e.g. `scratch_20260623T024000Z_a8f9c2d7b5e43a12.md`).
2. **Upload/Binding Execution**: Run the resolved issue tracking binding (e.g., `gh issue create` or `gh issue comment`) passing the contents of the unique scratch file.
3. **Draft Cleanup**: Upon successful creation/update, immediately delete the scratch markdown file.

---

## 🔄 Git Reconciliation Routine

To prevent git push locks and merge conflicts in multi-workspace backlog repositories:
1. **Pre-push Rebase**: Always run `git pull --rebase` inside the backlog repository before executing any commit or push.
2. **Exponential Backoff**: In case of push rejection or remote ref locking, sleep for a short duration and retry up to 3 times with exponential backoff (e.g., 1s, 2s, 4s).
3. **Conflict Resolution**: If git conflicts cannot be resolved automatically, dump the conflicting file contents to the scratch folder and request manual resolution from the user.

---

## 📶 Offline Mode & Local Queuing

To ensure task tracking states are preserved during offline mode, timeouts, or GitHub CLI/API failures:
1. **Detect Network Failures**: If any binding command fails with a non-zero exit code due to socket timeouts, DNS resolution failures, or API rate limits, catch the error.
2. **Queue Payload**: Move/rename the scratch file from `~/.config/shadow/scratch/scratch_*.md` to `~/.config/shadow/queue/queue_<timestamp>_<id>.md`.
3. **Start-of-Session Processing**: At the start of every session/task, check `~/.config/shadow/queue/` for any cached payloads.
4. **FIFO Re-synchronization**: If connectivity is restored (e.g., `gh auth status` passes or a ping succeeds), process all queue files chronologically (First-In, First-Out) using the appropriate bindings, then delete the queued files.

---

## 🐞 Configuration Failbacks & Error Recovery

To prevent agent crashes due to configuration faults:
1. **Validation & Recovery**: If the configuration file `~/.config/shadow/config.json` is missing or contains malformed JSON:
   - Fall back to vanilla CLI commands directly (e.g., standard `gh issue create`, `gh issue comment`).
   - Fall back to standard default labels (e.g., `type:ad-hoc`, `project:<name>`) if label mappings are corrupt.
2. **Error Logging**: Log configuration parsing warnings or command failures to the local log file `~/.config/shadow/error.log` instead of breaking execution.

