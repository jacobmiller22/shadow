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

## Agent Integration Details

### Claude Code Integration
- **Installation**: Install this skill locally by running `/plugin add --path ./skills/shadow` from the `shadow` repository root, or from a remote URL.
- **Invocation**: Triggered manually using `/shadow` or automatically when trigger conditions (such as switching tasks, git branches, or declaring a blocker) are met.

### Antigravity Integration
- **Execution**: Antigravity loads this skill by reading this file (`skills/shadow/SKILL.md`) using the `view_file` tool with `IsSkillFile: true`.
- **Action**: Once loaded, Antigravity acts as a shadow agent, proactively monitoring conversation events and task states, executing the CLI bindings defined in the configuration, and managing issue lifecycles.

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

### Required Labels

- `type:jira-shadow`: For tracking work mirroring an official Jira story.
- `type:ad-hoc`: Unplanned tasks, requests from teammates, Slack drive-bys, quick bug fixes.
- `type:personal-dev`: Upskilling, reading docs, architecture research, side projects.
- `type:blocker`: Dependencies holding up progress.
- `project:<project_name>`: Categorizes the issue under a specific project folder.

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
