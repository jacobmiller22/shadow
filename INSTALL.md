# Shadow Install Instructions

To install shadow, follow the instructions below to configure the tool dependencies, set up your backlog repository, and integrate the protocol with your agentic tools.

## Prerequisites

Ensure the following tools are installed:

- **GitHub CLI (`gh`)**: Used to execute task repository bindings.
- **jq**: Command-line JSON processor.

```bash
# Install dependencies via Homebrew (macOS)
brew install gh jq
```

Verify your GitHub CLI login status:
```bash
gh auth status
```
If not logged in, authenticate via:
```bash
gh auth login
```

---

## Step 1: Create & Clone your Backlog Repository

1. Create a private repository on GitHub to track your tasks (e.g., `shadowtracker`):
   ```bash
   gh repo create shadowtracker --private --add-readme
   ```
2. Clone this repository to a local directory of your choice on your machine:
   ```bash
   git clone git@github.com:jacobmiller22/shadowtracker.git ~/projects/shadowtracker
   ```
   *(Note down the exact directory where you cloned this repository, as you will need it in Step 2).*

---

## Step 2: Configure Shadow Config File

1. Create the global configuration directory:
   ```bash
   mkdir -p ~/.config/shadow
   ```
2. Copy the default configuration to this path:
   ```bash
   # (Run this command from the shadow workspace)
   cp example.config.json ~/.config/shadow/config.json
   ```
3. Open `~/.config/shadow/config.json` and configure:
   - **`target_repo`**: The exact SSH or HTTPS URL of your backlog repository (e.g., `git@github.com:your-username/your-shadow-backlog-repo.git`).
   - **`local_backlog_path`**: The absolute path to the local directory where you cloned the backlog repository in Step 1 (e.g., `/Users/your-username/projects/shadowtracker`).

Here is a template of `~/.config/shadow/config.json`:
```json
{
  "agent_identity": "shadow-task-tracker",
  "target_repo": "git@github.com:your-username/your-shadow-backlog-repo.git",
  "local_backlog_path": "/Users/your-username/projects/shadowtracker",
  "bindings": {
    "create_issue": "gh issue create --title \"{{title}}\" --body \"{{body}}\" --label \"{{labels}}\"",
    "search_issue": "gh issue list --search \"{{query}}\" --json number,title,labels",
    "update_issue": "gh issue comment {{issue_id}} --body \"{{body}}\"",
    "close_issue": "gh issue close {{issue_id}} --comment \"{{comment}}\"",
    "reopen_issue": "gh issue reopen {{issue_id}}",
    "list_issues": "gh issue list --state open --json number,title,labels",
    "view_issue": "gh issue view {{issue_id}} --json title,body,comments",
    "add_label": "gh issue edit {{issue_id}} --add-label \"{{label}}\"",
    "remove_label": "gh issue edit {{issue_id}} --remove-label \"{{label}}\""
  }
}
```

---

## Step 3: Install the /shadow Skill

The `/shadow` task-tracking skill is defined in `skills/shadow/SKILL.md` inside this repository. You can install it for different agent environments:

### A. Claude Code (CLI)
To install the skill in Claude Code, run the plugin command pointing to either the local directory or the remote repository:

```bash
# Option 1: Install from the local repository directory
/plugin add --path ./skills/shadow

# Option 2: Install directly from the GitHub repository URL
/plugin add https://github.com/jacobmiller22/shadow/tree/main/skills/shadow
```

Once installed, Claude Code will automatically detect context-switching triggers or allow manual execution using the `/shadow` slash command.

### B. Antigravity
To instruct Antigravity to follow the task tracking protocol, it will read `skills/shadow/SKILL.md` directly using the `view_file` tool with `IsSkillFile: true`. No additional command is required.

### C. Fallback: Global `CLAUDE.md` (For other compatible agents)
If your environment does not support folder-based skill packages, you can enable global task-tracking protocol support by appending it to your global `~/.claude/CLAUDE.md` file:

1. Ensure the global config directory exists:
   ```bash
   mkdir -p ~/.claude
   ```
2. Append the following protocol to `~/.claude/CLAUDE.md`:

```markdown
### Task Tracking Protocol (shadow)
You are equipped to help the user manage intense context switching by maintaining a private task repository.

1. **Config & Project Context Awareness**:
   - Locate and read the configuration file at `~/.config/shadow/config.json` to load the target repository and bindings.
   - For tasks under a project, read its directory at `projects/<project_name>/` in the backlog repository (defined by `local_backlog_path`). Parse `projects/<project_name>/README.md`'s YAML frontmatter to get the local directory (`local_path`) and documentation references (`docs_url`).
   - Execute task management operations (creating, searching, commenting, closing, reopening, listing, viewing, and labeling issues) by resolving the configured bindings.

2. **Proactive Shadowing**:
   - You do not need explicit permission to track tasks. If the user announces a pivot, a blocking issue, or an ad-hoc request, silently verify if a tracking issue exists. If not, create one.
   - When a task is completed or paused, append a brief comment to the issue listing the latest state, files edited, and shell commands that were successful.
   - Automatically close issues when tasks are completed, reopen them when resumed, or update labels.

3. **Format Enforcement**:
   - Always apply the metadata block and standard type labels outlined in the `SKILL.md` skill definition.
```

---

## 4. Configuration for Other Tools

### A. Claude Desktop (GitHub MCP Server)
If you use **Claude Desktop** and want to interact with your shadow task repository directly via UI/chat integration rather than executing command-line bindings, you can configure the official GitHub MCP server.

Add the following block to your `claude_desktop_config.json` (located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-personal-access-token-with-repo-scope>"
      }
    }
  }
}
```

### B. Command-line Auth Options
Ensure that whatever tool shell executes your bindings can authenticate with GitHub. 

- **Standard Interactive Setup**: Run `gh auth login` and complete the browser flow.
- **Non-interactive / Daemon Setup**: Set the environment variable in your shell profile (`~/.zshrc` or `~/.bashrc`):
  ```bash
  export GITHUB_TOKEN="<your-personal-access-token>"
  ```
