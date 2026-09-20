import {
  SyncQueueManager,
  SyncAuditLogger,
  PrivacyFirewall,
  EnvironmentResolver,
  SQLiteConnectionFactory,
} from "@shadow/shared";
import type { GlobalCliOptions } from "./task";
import { OutputFormatter } from "../formatters/output";

export interface SyncCliOptions {
  dryRun?: boolean;
  strategy?: "ours" | "theirs" | "prompt";
  quiet?: boolean;
}

export class SyncCommandHandler {
  private static getDb(globalOpts: GlobalCliOptions) {
    const dbPath = EnvironmentResolver.resolveDatabasePath({
      explicitPath: globalOpts.dbPath,
      envOverride: globalOpts.env,
    });
    return SQLiteConnectionFactory.open(dbPath);
  }

  public static async run(
    options: SyncCliOptions,
    globalOpts: GlobalCliOptions
  ): Promise<void> {
    const db = this.getDb(globalOpts);
    try {
      const queueManager = new SyncQueueManager(db);
      const auditLogger = new SyncAuditLogger(db);

      const pending = queueManager.getPending();

      if (options.dryRun) {
        const sanitizedPreview: any[] = [];
        for (const item of pending) {
          let payload: any = {};
          try {
            payload = JSON.parse(item.payload);
          } catch {
            payload = item.payload;
          }

          if (payload.title) {
            const redactedTitle = PrivacyFirewall.redactString(payload.title);
            payload.title = redactedTitle.text;
          }
          if (payload.description) {
            const redactedDesc = PrivacyFirewall.redactString(payload.description);
            payload.description = redactedDesc.text;
          }

          sanitizedPreview.push({
            id: item.id,
            action: item.action,
            entityId: item.entityId,
            sanitizedPayload: payload,
          });
        }

        if (OutputFormatter.isJsonMode(globalOpts)) {
          console.log(
            JSON.stringify(
              {
                dryRun: true,
                pendingCount: pending.length,
                preview: sanitizedPreview,
              },
              null,
              2
            )
          );
        } else {
          console.log(`🔎 [DRY-RUN] Outbound Sync Preview (${pending.length} pending mutations):`);
          if (sanitizedPreview.length === 0) {
            console.log("  No pending mutations to sync.");
          } else {
            for (const p of sanitizedPreview) {
              console.log(`  - [${p.action.toUpperCase()}] ${p.entityId}: ${JSON.stringify(p.sanitizedPayload)}`);
            }
          }
        }
        return;
      }

      // Live sync execution
      const edgeUrl = process.env.SHADOW_EDGE_URL;
      let pushSuccess = 0;
      let pushFailed = 0;

      if (edgeUrl) {
        try {
          const payloadItems = pending.map((item) => ({
            id: item.id,
            entityType: item.entityType,
            entityId: item.entityId,
            action: item.action,
            payload: item.payload,
            createdAt: item.createdAt,
          }));

          const res = await fetch(`${edgeUrl}/v1/sync/push`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mutations: payloadItems }),
          });

          if (!res.ok) {
            throw new Error(`Edge returned HTTP ${res.status}`);
          }

          for (const item of pending) {
            queueManager.markSynced(item.id);
            auditLogger.log("edge", item.action, item.payload, "success");
            pushSuccess++;
          }
        } catch (err: any) {
          for (const item of pending) {
            queueManager.markFailed(item.id, err.message);
            auditLogger.log("edge", item.action, item.payload, "failed");
            pushFailed++;
          }
        }
      } else {
        // Local offline drain simulation / audit record
        const res = await queueManager.drain(async (item) => {
          let payload: any = {};
          try {
            payload = JSON.parse(item.payload);
          } catch {
            payload = item.payload;
          }

          if (payload.is_private || (payload.title && payload.title.includes("#private"))) {
            return;
          }

          auditLogger.log("local_sync", item.action, payload, "success");
        });

        pushSuccess = res.processed;
        pushFailed = res.failed;
      }

      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(
          JSON.stringify(
            {
              success: pushFailed === 0,
              synced: pushSuccess,
              failed: pushFailed,
            },
            null,
            2
          )
        );
      } else if (!options.quiet) {
        OutputFormatter.printSuccess(`Sync complete: ${pushSuccess} mutations processed, ${pushFailed} failed.`);
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  }
}
