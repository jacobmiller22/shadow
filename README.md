# shadow 👤

A personal, automated task-tracking system that uses your agentic AI workflow to maintain a "shadow log" of tasks in a private GitHub repository. This removes the cognitive load of tracking statuses, updates, and blockers during intense context switching.

## Features

- **Proactive Task Logging**: Automatically captures task pivots, Slack drive-bys, and git branch changes.
- **Configurable Bindings**: Maps task operations directly to command line tools (like `gh` CLI) or custom internal tools defined in a single configuration file.
- **Rich Context Metadata**: Tags tasks with deadlines, origin sources, status, and tech tags to maintain clean backlog organization.

---

## Setup & Installation

For complete setup and installation instructions, including prerequisites, config setup, and `CLAUDE.md` integration, please see the [INSTALL.md](file:///Users/jacobmiller22/projects/shadow/INSTALL.md) guide.

---

## File Structure

- [SKILL.md](file:///Users/jacobmiller22/projects/shadow/SKILL.md): Defines the core capabilities, metadata, and labeling schema.
- [example.config.json](file:///Users/jacobmiller22/projects/shadow/example.config.json): Declarative configuration template defining bindings for tools (like `gh` CLI or other internal tools).
- [TASK_GUIDELINES.md](file:///Users/jacobmiller22/projects/shadow/TASK_GUIDELINES.md): Concrete examples and triggers of when to log issues.
