#!/usr/bin/env bash
#
# Shadow Installation & Configuration Script
# Automates the setup of the shadow tool environment and Gemini agent skills.
#

set -euo pipefail

# Color helper functions
info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
success() { echo -e "\033[1;32m[SUCCESS]\033[0m $*"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $*"; }

echo "==========================================="
echo "      Installing Shadow Task Tracker       "
echo "==========================================="

# 1. Prerequisite Checks
info "Checking prerequisites..."

if ! command -v gh &> /dev/null; then
    error "GitHub CLI ('gh') is not installed. Please run 'brew install gh' first."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    error "jq is not installed. Please run 'brew install jq' first."
    exit 1
fi

success "Prerequisites (gh, jq) are installed."

# 2. GitHub Auth Check
info "Verifying GitHub CLI authentication status..."
if ! gh auth status &> /dev/null; then
    warn "You are not logged into GitHub CLI."
    warn "Please authenticate by running 'gh auth login' or ensure GITHUB_TOKEN is set."
    warn "Continuing installation, but bindings may fail until authenticated."
else
    success "GitHub CLI is authenticated."
fi

# 3. Create Configuration, Scratch, and Queue Directories
CONFIG_DIR="$HOME/.config/shadow"
SCRATCH_DIR="$CONFIG_DIR/scratch"
QUEUE_DIR="$CONFIG_DIR/queue"
ERROR_LOG="$CONFIG_DIR/error.log"

info "Creating configuration and queue directories..."
mkdir -p "$CONFIG_DIR"
mkdir -p "$SCRATCH_DIR"
mkdir -p "$QUEUE_DIR"
touch "$ERROR_LOG"
success "Directories created: $CONFIG_DIR, $SCRATCH_DIR, and $QUEUE_DIR"

# Prune scratch files older than 24 hours (TTL Cleanup)
info "Cleaning up stale scratch drafts older than 24 hours..."
if [ -d "$SCRATCH_DIR" ]; then
    find "$SCRATCH_DIR" -name "scratch_*" -mtime +1 -delete 2>/dev/null || true
fi
success "Stale drafts pruned."

# 4. Copy and Initialize Config File
CONFIG_FILE="$CONFIG_DIR/config.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_CONFIG="$SCRIPT_DIR/example.config.json"

if [ ! -f "$CONFIG_FILE" ]; then
    info "No existing config.json found at $CONFIG_FILE. Initializing from template..."
    if [ -f "$EXAMPLE_CONFIG" ]; then
        cp "$EXAMPLE_CONFIG" "$CONFIG_FILE"
        success "Initialized configuration at $CONFIG_FILE"
        info "Please open $CONFIG_FILE and set your 'target_repo' and 'local_backlog_path'."
    else
        error "Template config not found at $EXAMPLE_CONFIG!"
        exit 1
    fi
else
    info "Found existing config.json at $CONFIG_FILE. Leaving it intact."
fi

# 5. Install Antigravity Skill Globally
ANTIGRAVITY_SKILL_DIR="$HOME/.gemini/config/skills/shadow"
SKILL_SOURCE="$SCRIPT_DIR/skills/shadow/SKILL.md"

info "Installing Antigravity global skill..."
mkdir -p "$ANTIGRAVITY_SKILL_DIR"

if [ -f "$SKILL_SOURCE" ]; then
    cp "$SKILL_SOURCE" "$ANTIGRAVITY_SKILL_DIR/SKILL.md"
    success "Antigravity skill copied to $ANTIGRAVITY_SKILL_DIR/SKILL.md"
else
    error "Skill source file not found at $SKILL_SOURCE!"
    exit 1
fi

echo "==========================================="
success "Shadow installation completed successfully!"
echo "==========================================="
info "Next Steps:"
echo "  1. Verify/update your config at: $CONFIG_FILE"
echo "  2. Ensure your backlog repo is cloned at the 'local_backlog_path' value."
echo "  3. Start using shadow asynchronously in your agent workflow!"
