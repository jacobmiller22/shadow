import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export type ShadowEnvironment = "production" | "development" | "test";

export interface DatabasePathOptions {
  explicitPath?: string;
  envOverride?: string;
  repoRoot?: string;
}

export class EnvironmentResolver {
  /**
   * Resolves the active Shadow environment name.
   */
  public static getEnvironment(overrideEnv?: string): ShadowEnvironment {
    const raw = (overrideEnv || process.env.SHADOW_ENV || "").toLowerCase().trim();
    if (raw === "test") return "test";
    if (raw === "development" || raw === "dev") return "development";
    return "production";
  }

  /**
   * Resolves the absolute database file path based on priority order:
   * 1. explicitPath (--db-path flag)
   * 2. process.env.SHADOW_DB_PATH
   * 3. SHADOW_ENV lookup (test -> :memory: or /tmp, development -> .shadow-dev, production -> ~/.local/share/shadow)
   */
  public static resolveDatabasePath(options: DatabasePathOptions = {}): string {
    // 1. Explicit CLI flag
    if (options.explicitPath && options.explicitPath.trim().length > 0) {
      const explicit = path.resolve(options.explicitPath.trim());
      this.ensureDirectory(path.dirname(explicit));
      return explicit;
    }

    // 2. Env variable override
    const envPath = process.env.SHADOW_DB_PATH;
    if (envPath && envPath.trim().length > 0) {
      const resolved = path.resolve(envPath.trim());
      this.ensureDirectory(path.dirname(resolved));
      return resolved;
    }

    // 3. Environment tier resolution
    const env = this.getEnvironment(options.envOverride);

    if (env === "test") {
      // In-memory or unique ephemeral temp database
      const tempDbPath = path.join(os.tmpdir(), `shadow-test-${crypto.randomUUID()}.db`);
      return tempDbPath;
    }

    if (env === "development") {
      const root = options.repoRoot || process.cwd();
      const devDir = path.join(root, ".shadow-dev");
      this.ensureDirectory(devDir);
      return path.join(devDir, "shadow.db");
    }

    // Production environment
    const home = os.homedir();
    const prodDir = path.join(home, ".local", "share", "shadow");
    this.ensureDirectory(prodDir);
    return path.join(prodDir, "shadow.db");
  }

  /**
   * Resolves the storage directory for backups and metadata.
   */
  public static resolveStorageDirectory(options: DatabasePathOptions = {}): string {
    const dbPath = this.resolveDatabasePath(options);
    if (dbPath === ":memory:" || dbPath.startsWith(os.tmpdir())) {
      const testDir = path.join(os.tmpdir(), "shadow-test-storage");
      this.ensureDirectory(testDir);
      return testDir;
    }
    const dir = path.dirname(dbPath);
    this.ensureDirectory(dir);
    return dir;
  }

  /**
   * Ensures parent directories exist with strict 0700 permissions (owner read/write/execute only).
   */
  public static ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    } else {
      try {
        fs.chmodSync(dirPath, 0o700);
      } catch {
        // Fallback gracefully on systems that do not support POSIX chmod
      }
    }
  }
}
