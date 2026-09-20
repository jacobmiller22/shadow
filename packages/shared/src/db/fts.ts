import { Database } from "bun:sqlite";

export interface FTSMatchResult {
  id: string;
  title: string;
  description: string | null;
  rank: number;
}

export class FTSSearchEngine {
  /**
   * Sanitizes and builds a safe FTS5 query string from user input.
   * Supports phrase matching, prefix matching (*), and boolean terms.
   */
  public static sanitizeQuery(rawQuery: string): string {
    const trimmed = rawQuery.trim();
    if (!trimmed) return "";

    // Escape special FTS5 operators except valid syntax
    // Replace double quotes and special punctuation that would break parser
    const terms = trimmed
      .split(/\s+/)
      .map((term) => {
        // Strip non-alphanumeric except hyphen and underscore
        const cleaned = term.replace(/[^\w-]/g, "");
        if (!cleaned) return "";
        // Append prefix wildcard for partial word matches
        return `"${cleaned}"*`;
      })
      .filter(Boolean);

    return terms.join(" AND ");
  }

  /**
   * Executes a full-text search against the tasks_fts virtual table using SQLite FTS5 rank ordering.
   */
  public static search(
    db: Database,
    query: string,
    limit: number = 20
  ): FTSMatchResult[] {
    const ftsQuery = this.sanitizeQuery(query);
    if (!ftsQuery) return [];

    try {
      const stmt = db.query(`
        SELECT
          t.id,
          t.title,
          t.description,
          tasks_fts.rank
        FROM tasks_fts
        JOIN tasks t ON t.id = tasks_fts.id
        WHERE tasks_fts MATCH ?
        ORDER BY tasks_fts.rank
        LIMIT ?;
      `);

      return stmt.all(ftsQuery, limit) as FTSMatchResult[];
    } catch {
      // Fallback to standard LIKE search if FTS query encounters syntax anomaly
      const fallbackStmt = db.query(`
        SELECT
          id,
          title,
          description,
          0 as rank
        FROM tasks
        WHERE title LIKE ? OR description LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?;
      `);
      const wild = `%${query}%`;
      return fallbackStmt.all(wild, wild, limit) as FTSMatchResult[];
    }
  }
}
