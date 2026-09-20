import { execSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

export interface GitContext {
  isGitRepo: boolean;
  repoRoot: string;
  workspaceId: string;
  currentBranch: string;
  isWorktree: boolean;
}

export class GitContextResolver {
  private static cachedContext: GitContext | null = null;

  /**
   * Resolves the current Git context, repository root, and canonical workspace ID.
   */
  public static resolve(cwd: string = process.cwd(), forceFresh: boolean = false): GitContext {
    if (this.cachedContext && !forceFresh) {
      return this.cachedContext;
    }

    try {
      // 1. Check if inside git worktree/repo
      const topLevel = execSync("git rev-parse --show-toplevel", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
      }).trim();

      // 2. Identify root commit hash (remains invariant across all Git worktrees)
      let rootCommit = "";
      try {
        rootCommit = execSync("git rev-list --max-parents=0 HEAD", {
          cwd: topLevel,
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf-8",
        }).trim().split("\n")[0];
      } catch {
        rootCommit = topLevel;
      }

      // Generate deterministic workspaceId from root commit or normalized path
      const workspaceId = crypto
        .createHash("sha256")
        .update(rootCommit || topLevel)
        .digest("hex")
        .slice(0, 16);

      // 3. Current active branch
      let currentBranch = "main";
      try {
        currentBranch = execSync("git branch --show-current", {
          cwd,
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf-8",
        }).trim();
        if (!currentBranch) {
          // Detached HEAD fallback
          currentBranch = execSync("git rev-parse --short HEAD", {
            cwd,
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf-8",
          }).trim();
        }
      } catch {
        currentBranch = "main";
      }

      // 4. Check if current directory is a linked worktree
      let isWorktree = false;
      try {
        const gitDir = execSync("git rev-parse --git-dir", {
          cwd,
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf-8",
        }).trim();
        // In a linked worktree, git-dir contains .git/worktrees/
        isWorktree = gitDir.includes("/worktrees/") || gitDir.includes("\\worktrees\\");
      } catch {
        isWorktree = false;
      }

      const context: GitContext = {
        isGitRepo: true,
        repoRoot: topLevel,
        workspaceId,
        currentBranch: currentBranch || "main",
        isWorktree,
      };

      this.cachedContext = context;
      return context;
    } catch {
      // Fallback for non-git directories
      const fallbackWorkspaceId = crypto
        .createHash("sha256")
        .update(path.resolve(cwd))
        .digest("hex")
        .slice(0, 16);

      const context: GitContext = {
        isGitRepo: false,
        repoRoot: path.resolve(cwd),
        workspaceId: fallbackWorkspaceId,
        currentBranch: "main",
        isWorktree: false,
      };

      this.cachedContext = context;
      return context;
    }
  }

  public static clearCache(): void {
    this.cachedContext = null;
  }
}
