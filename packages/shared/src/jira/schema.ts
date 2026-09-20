import { Database } from "bun:sqlite";
import { SQLiteConnectionFactory } from "../db/connection";

export interface JiraFieldMetadata {
  key: string;
  name: string;
  required: boolean;
  type: string;
  allowedValues?: Array<{ id: string; name?: string; value?: string }>;
}

export interface JiraProjectSchema {
  projectKey: string;
  issueTypes: Array<{
    id: string;
    name: string;
    fields: Record<string, JiraFieldMetadata>;
  }>;
}

export interface FieldDefaultMap {
  [fieldKey: string]: any;
}

export class JiraSchemaResolver {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Retrieves cached schema for a project.
   */
  public getCachedSchema(projectKey: string): JiraProjectSchema | null {
    const row = this.db
      .query(
        `SELECT schema_json FROM remote_schema_cache
         WHERE remote_system = 'jira' AND project_key = ?
         ORDER BY cached_at DESC LIMIT 1;`
      )
      .get(projectKey) as any;

    if (!row) return null;
    try {
      return JSON.parse(row.schema_json);
    } catch {
      return null;
    }
  }

  /**
   * Caches introspected schema for a project.
   */
  public saveSchema(projectKey: string, schema: JiraProjectSchema): void {
    const now = Date.now();
    SQLiteConnectionFactory.withRetry(() => {
      this.db
        .query(
          `INSERT INTO remote_schema_cache (remote_system, project_key, schema_json, cached_at)
           VALUES ('jira', ?, ?, ?);`
        )
        .run(projectKey, JSON.stringify(schema), now);
    });
  }

  /**
   * Validates and enriches a payload with configured field defaults to satisfy mandatory Jira custom fields (SHD-JIRA-002).
   */
  public populateDefaults(
    fields: Record<string, any>,
    projectSchema?: JiraProjectSchema | null,
    defaults?: FieldDefaultMap
  ): { enriched: Record<string, any>; missingRequired: string[] } {
    const enriched = { ...fields };
    const missing: string[] = [];

    // Apply configured defaults
    if (defaults) {
      for (const [key, value] of Object.entries(defaults)) {
        if (enriched[key] === undefined || enriched[key] === null) {
          enriched[key] = value;
        }
      }
    }

    // Check against schema if provided
    if (projectSchema && projectSchema.issueTypes.length > 0) {
      const issueType = projectSchema.issueTypes[0];
      for (const [fieldKey, meta] of Object.entries(issueType.fields)) {
        if (meta.required && (enriched[fieldKey] === undefined || enriched[fieldKey] === null)) {
          // Check if default exists
          if (defaults && defaults[fieldKey] !== undefined) {
            enriched[fieldKey] = defaults[fieldKey];
          } else {
            missing.push(meta.name || fieldKey);
          }
        }
      }
    }

    return { enriched, missingRequired: missing };
  }
}
