import fs from "node:fs";
import path from "node:path";
import { OutputFormatter } from "../formatters/output";
import type { GlobalCliOptions } from "./task";

export class HookCommandHandler {
  private static getGitHooksDir(): string | null {
    let curr = process.cwd();
    while (curr !== path.dirname(curr)) {
      const gitDir = path.join(curr, ".git");
      if (fs.existsSync(gitDir)) {
        if (fs.statSync(gitDir).isDirectory()) {
          return path.join(gitDir, "hooks");
        } else {
          // Git worktree: .git is a file pointing to gitdir: ...
          const content = fs.readFileSync(gitDir, "utf-8").trim();
          const match = content.match(/^gitdir:\s*(.+)$/);
          if (match && match[1]) {
            return path.join(match[1], "hooks");
          }
        }
      }
      curr = path.dirname(curr);
    }
    return null;
  }

  public static install(globalOpts: GlobalCliOptions): void {
    const hooksDir = this.getGitHooksDir();
    if (!hooksDir) {
      OutputFormatter.printError(new Error("Not inside a git repository or worktree"), globalOpts);
      process.exitCode = 1;
      return;
    }

    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    // 1. Post-commit hook: records commit into active task
    const postCommitPath = path.join(hooksDir, "post-commit");
    const postCommitScript = `#!/usr/bin/env bash
# Shadow Git Hook: Post-Commit Active Task Auditor (SHD-TUI-004)
if command -v shadow >/dev/null 2>&1; then
  ACTIVE_TASK=$(shadow task active --json 2>/dev/null | grep -o '"id": *"[^"]*"' | head -n1 | cut -d'"' -f4)
  if [ -n "$ACTIVE_TASK" ]; then
    COMMIT_HASH=$(git rev-parse --short HEAD)
    COMMIT_MSG=$(git log -1 --pretty=%s)
    shadow task comment "$ACTIVE_TASK" "git commit $COMMIT_HASH: $COMMIT_MSG" >/dev/null 2>&1 &
  fi
fi
`;

    // 2. Pre-push hook: triggers background sync without blocking push
    const prePushPath = path.join(hooksDir, "pre-push");
    const prePushScript = `#!/usr/bin/env bash
# Shadow Git Hook: Pre-Push Background Sync (SHD-TUI-004)
if command -v shadow >/dev/null 2>&1; then
  shadow sync --quiet >/dev/null 2>&1 &
fi
`;

    fs.writeFileSync(postCommitPath, postCommitScript, { mode: 0o755 });
    fs.writeFileSync(prePushPath, prePushScript, { mode: 0o755 });

    if (OutputFormatter.isJsonMode(globalOpts)) {
      console.log(
        JSON.stringify(
          {
            installed: true,
            hooks: ["post-commit", "pre-push"],
            hooksDir,
          },
          null,
          2
        )
      );
    } else {
      OutputFormatter.printSuccess(`Installed Shadow Git hooks to ${hooksDir}:`);
      console.log("  • post-commit (audit commits to active task)");
      console.log("  • pre-push (background sync)");
    }
  }

  public static uninstall(globalOpts: GlobalCliOptions): void {
    const hooksDir = this.getGitHooksDir();
    if (!hooksDir) {
      OutputFormatter.printError(new Error("Not inside a git repository or worktree"), globalOpts);
      process.exitCode = 1;
      return;
    }

    const postCommitPath = path.join(hooksDir, "post-commit");
    const prePushPath = path.join(hooksDir, "pre-push");

    let removed = 0;
    if (fs.existsSync(postCommitPath)) {
      fs.unlinkSync(postCommitPath);
      removed++;
    }
    if (fs.existsSync(prePushPath)) {
      fs.unlinkSync(prePushPath);
      removed++;
    }

    if (OutputFormatter.isJsonMode(globalOpts)) {
      console.log(JSON.stringify({ uninstalled: true, count: removed }, null, 2));
    } else {
      OutputFormatter.printSuccess(`Uninstalled ${removed} Shadow Git hooks.`);
    }
  }
}
