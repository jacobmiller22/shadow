# Installing & Configuring Shadow (v2.0)

Shadow is an ultra-low latency ($< 20\text{ms}$), local-first issue engine and Cloudflare Edge sync ecosystem for autonomous AI coding agents and human developers.

---

## 1. Quick Installation

### Option A: One-Line Curl Installer (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/jacobmiller22/shadow/main/install.sh | bash
```
Installs the pre-compiled standalone binary to `~/.local/bin/shadow`.

### Option B: Homebrew Tap (macOS & Linux)
```bash
brew tap jacobmiller22/shadow
brew install shadow
```

### Option C: Build from Source with Bun
Prerequisites: [Bun](https://bun.sh) 1.2+
```bash
git clone https://github.com/jacobmiller22/shadow.git
cd shadow
bun install
bun run build:cli
# Binary compiled to bin/shadow
cp bin/shadow ~/.local/bin/
```

---

## 2. Agent Skill Installation

Shadow provides a universal Agent Skill protocol specification compatible with Google Antigravity, Claude Code, and Cursor.

Run the automated multi-agent installer script:
```bash
./scripts/install_skill.sh
```
This automatically links `skills/shadow/SKILL.md` to:
- **Google Antigravity:** `~/.gemini/antigravity/skills/shadow`
- **Claude Code:** `~/.claude/skills/shadow`
- **Cursor IDE:** `~/.cursor/skills/shadow`

---

## 3. Shell Autocompletions

Generate native autocompletion scripts for your shell:

### Zsh
```bash
shadow completion zsh > ~/.zsh/completion/_shadow
```
### Bash
```bash
shadow completion bash > /etc/bash_completion.d/shadow
```
### Fish
```bash
shadow completion fish > ~/.config/fish/completions/shadow.fish
```

---

## 4. Git Hook Automation

Install non-blocking post-commit and pre-push hooks:
```bash
shadow hook install
```
- **`post-commit`:** Stamps commit SHAs into the currently active task's audit trail.
- **`pre-push`:** Spawns asynchronous background sync (`shadow sync --quiet &`).

---

## 5. Cloudflare Edge Sync Pairing

To connect your local CLI to a corporate Jira instance via the Cloudflare Edge Bridge:
```bash
# Pair device
shadow sync
```
Or configure environment variables in `~/.config/shadow/config.env`:
```bash
SHADOW_EDGE_URL="https://edge.shadow.dev"
SHADOW_WEB_TOKEN="<your-shared-secret>"
```
