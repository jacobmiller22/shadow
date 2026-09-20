#!/usr/bin/env bash
# Shadow Multi-Agent Skill Installer (SHD-SKILL-002)
# Installs skills/shadow/SKILL.md to Antigravity, Claude Code, and Cursor environments.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE_SKILL="$REPO_ROOT/skills/shadow/SKILL.md"

echo "👤 Shadow Multi-Agent Skill Distribution Installer"
echo "=================================================="

if [[ ! -f "$SOURCE_SKILL" ]]; then
  echo "Error: Skill file not found at $SOURCE_SKILL" >&2
  exit 1
fi

INSTALLED=0

# 1. Antigravity Skill Installation
AGY_DIR="$HOME/.gemini/config/skills/shadow"
if [[ -d "$HOME/.gemini" || -d "$HOME/.gemini/config" ]]; then
  mkdir -p "$AGY_DIR"
  cp "$SOURCE_SKILL" "$AGY_DIR/SKILL.md"
  echo "✓ Installed Antigravity skill: $AGY_DIR/SKILL.md"
  INSTALLED=$((INSTALLED + 1))
fi

# 2. Claude Code Skill Installation
CLAUDE_DIR="$HOME/.claude/skills/shadow"
if [[ -d "$HOME/.claude" ]]; then
  mkdir -p "$CLAUDE_DIR"
  cp "$SOURCE_SKILL" "$CLAUDE_DIR/SKILL.md"
  echo "✓ Installed Claude Code skill: $CLAUDE_DIR/SKILL.md"
  INSTALLED=$((INSTALLED + 1))
fi

# 3. Cursor Rules Installation
CURSOR_DIR="$REPO_ROOT/.cursor/rules"
mkdir -p "$CURSOR_DIR"
cp "$SOURCE_SKILL" "$CURSOR_DIR/shadow.mdc"
echo "✓ Installed Cursor rule: $CURSOR_DIR/shadow.mdc"
INSTALLED=$((INSTALLED + 1))

echo "=================================================="
echo "✨ Successfully distributed Shadow skill to $INSTALLED environment(s)."
