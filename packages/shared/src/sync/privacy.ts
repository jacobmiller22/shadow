import type { Task } from "../db/schema";

export interface RedactionResult {
  text: string;
  redactionsCount: number;
  matches: string[];
}

export class PrivacyFirewall {
  // Common secret & sensitive data patterns
  private static readonly SECRET_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
    // AWS Access Key ID
    { name: "AWS_KEY", regex: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED_AWS_KEY]" },
    // GitHub Personal Access Token (ghp_*, gho_*, etc.)
    { name: "GITHUB_TOKEN", regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
    // Bearer / JWT Token
    { name: "BEARER_TOKEN", regex: /Bearer\s+ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}/gi, replacement: "Bearer [REDACTED_JWT]" },
    // Generic API Key assignments
    { name: "GENERIC_API_KEY", regex: /(api_?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-\.]{8,}['"]/gi, replacement: "$1: \"[REDACTED_SECRET]\"" },
    // Absolute macOS/Linux user paths
    { name: "USER_PATH", regex: /\/(Users|home)\/[a-zA-Z0-9._-]+\//g, replacement: "~/" },
    // Private IPv4 addresses
    { name: "PRIVATE_IP", regex: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g, replacement: "[REDACTED_IP]" },
  ];

  /**
   * Checks if a task is explicitly marked as private.
   */
  public static isPrivate(task: Task): boolean {
    if (task.title.includes("#private") || (task.description && task.description.includes("#private"))) {
      return true;
    }

    if (task.metadata) {
      try {
        const meta = typeof task.metadata === "string" ? JSON.parse(task.metadata) : task.metadata;
        if (meta.is_private === true || meta.private === true) {
          return true;
        }
      } catch {
        // Ignored
      }
    }

    return false;
  }

  /**
   * Redacts sensitive secrets and user filepaths from a string.
   */
  public static redactString(input: string): RedactionResult {
    let text = input;
    let count = 0;
    const matches: string[] = [];

    for (const pattern of this.SECRET_PATTERNS) {
      const found = text.match(pattern.regex);
      if (found) {
        count += found.length;
        matches.push(...found.map((m) => `${pattern.name}: ${m.slice(0, 8)}...`));
        text = text.replace(pattern.regex, pattern.replacement);
      }
    }

    return {
      text,
      redactionsCount: count,
      matches,
    };
  }

  /**
   * Sanitizes a task for remote transmission:
   * 1. Drops task if private (returns null).
   * 2. Strips internal fields (notes, agent_scratchpad, stacktrace).
   * 3. Redacts secrets & home directory paths from title and description.
   */
  public static sanitizeTask(task: Task): Task | null {
    if (this.isPrivate(task)) {
      return null;
    }

    const sanitizedTitle = this.redactString(task.title).text;
    const sanitizedDesc = task.description ? this.redactString(task.description).text : null;

    let sanitizedMetadata: string | null = null;
    if (task.metadata) {
      try {
        const meta = typeof task.metadata === "string" ? JSON.parse(task.metadata) : task.metadata;
        // Strip sensitive internal blacklisted keys
        delete meta.notes;
        delete meta.agent_scratchpad;
        delete meta.stacktrace;
        delete meta.internal_metadata;
        sanitizedMetadata = JSON.stringify(meta);
      } catch {
        sanitizedMetadata = null;
      }
    }

    return {
      ...task,
      title: sanitizedTitle,
      description: sanitizedDesc,
      metadata: sanitizedMetadata,
    };
  }
}
