import {
  SyncAuditLogger,
  EnvironmentResolver,
  SQLiteConnectionFactory,
} from "@shadow/shared";
import type { GlobalCliOptions } from "./task";
import { OutputFormatter } from "../formatters/output";

export class AuditCommandHandler {
  private static getDb(globalOpts: GlobalCliOptions) {
    const dbPath = EnvironmentResolver.resolveDatabasePath({
      explicitPath: globalOpts.dbPath,
      envOverride: globalOpts.env,
    });
    return SQLiteConnectionFactory.open(dbPath);
  }

  public static list(options: { limit?: string }, globalOpts: GlobalCliOptions): void {
    const db = this.getDb(globalOpts);
    try {
      const auditLogger = new SyncAuditLogger(db);

      const limit = options.limit ? parseInt(options.limit, 10) : 50;
      const records = auditLogger.list(limit);

      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(records, null, 2));
      } else {
        if (records.length === 0) {
          console.log("No audit records found.");
          return;
        }
        console.log(`📜 Shadow Sync Audit Log (Latest ${records.length} events):`);
        for (const rec of records) {
          const time = new Date(rec.createdAt).toISOString();
          console.log(`  [${time}] [${rec.status.toUpperCase()}] -> ${rec.destination}: ${rec.action} (hash: ${rec.payloadHash.slice(0, 8)})`);
        }
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  }
}
