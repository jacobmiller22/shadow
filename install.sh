#!/usr/bin/env bash
set -e

# Shadow Single-Command Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/jacobmiller22/shadow/main/install.sh | bash

REPO="jacobmiller22/shadow"
INSTALL_DIR="${SHADOW_INSTALL_DIR:-$HOME/.local/bin}"

echo "⚡ Installing Shadow CLI..."

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    if [ "$ARCH" = "arm64" ]; then
      TARGET="shadow-darwin-arm64"
    else
      TARGET="shadow-darwin-x64"
    fi
    ;;
  Linux)
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
      TARGET="shadow-linux-arm64"
    else
      TARGET="shadow-linux-x64"
    fi
    ;;
  *)
    echo "❌ Unsupported operating system: $OS"
    exit 1
    ;;
esac

mkdir -p "$INSTALL_DIR"

# Download latest release binary
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$TARGET"
echo "⬇️  Downloading $TARGET..."

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/shadow" || true
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$INSTALL_DIR/shadow" "$DOWNLOAD_URL" || true
fi

# Fallback: if downloading latest release fails (e.g. repo is private or pre-release), compile via local Bun if available
if [ ! -f "$INSTALL_DIR/shadow" ] || [ ! -s "$INSTALL_DIR/shadow" ]; then
  if command -v bun >/dev/null 2>&1 && [ -f "./packages/cli/src/index.ts" ]; then
    echo "ℹ️  Building local standalone binary via Bun..."
    bun build --compile --minify packages/cli/src/index.ts --outfile "$INSTALL_DIR/shadow"
  else
    echo "⚠️ Could not download pre-built binary and Bun is not available."
    exit 1
  fi
fi

chmod +x "$INSTALL_DIR/shadow"

echo "✅ Successfully installed shadow to $INSTALL_DIR/shadow"
echo ""
echo "Make sure $INSTALL_DIR is in your PATH:"
echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
echo ""
echo "Verify installation:"
echo "  shadow --help"
EOF && chmod +x install.sh