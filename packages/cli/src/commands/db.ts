import fs from "node:fs";
import { Database } from "bun:sqlite";
import {
  BackupService,
  SQLiteConnectionFactory,
  EnvironmentResolver,
} from "@shadow/shared";
import { OutputFormatter } from "../formatters/output";
import type { GlobalCliOptions } from "./task";

export class DbCommandHandler {
  public static backup(globalOpts: GlobalCliOptions): void {
    const dbPath = EnvironmentResolver.resolveDatabasePath({
      explicitPath: globalOpts.dbPath,
      envOverride: globalOpts.env,
    });
    const db = SQLiteConnectionFactory.open(dbPath);
    try {
      const info = BackupService.createSnapshot(db);
      if (OutputFormatter.isJsonMode(globalOpts)) {
        console.log(JSON.stringify(info, null, 2));
      } else {
        OutputFormatter.printSuccess(`Database backup created: ${info.filePath}`);
        console.log(`  Size: ${(info.sizeBytes / 1024).toFixed(2)} KB`);
      }
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  }

  public static restore(snapshotPath: string, globalOpts: GlobalCliOptions): void {
    const targetDbPath = EnvironmentResolver.resolveDatabasePath({
      explicitPath: globalOpts.dbPath,
      envOverride: globalOpts.env,
    });
    try {
      BackupService.restoreFromSnapshot(snapshotPath, targetDbPath);
      OutputFormatter.printSuccess(`Database restored from ${snapshotPath}`);
    } catch (err) {
      OutputFormatter.printError(err, globalOpts);
      process.exitCode = 1;
    }
  }

  public static status(globalOpts: GlobalCliOptions): void {
    const dbPath = EnvironmentResolver.resolveDatabasePath({
      explicitPath: globalOpts.dbPath,
      envOverride: globalOpts.env,
    });
    const env = EnvironmentResolver.getEnvironment(globalOpts.env);
    const dbExists = fs.existsSync(dbPath);
    let sizeBytes = 0;
    let walSizeBytes = 0;
    let integrity = { ok: false, message: "Database file does not exist" };

    if (dbExists) {
      sizeBytes = fs.statSync(dbPath).size;
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
      const db = new Database(dbPath, { readonly: true });
      integrity = BackupService.checkIntegrity(db);
      db.close();
    }

    const payload = {
      environment: env,
      databasePath: dbPath,
      exists: dbExists,
      sizeBytes,
      walSizeBytes,
      integrity,
    };

    if (OutputFormatter.isJsonMode(globalOpts)) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`\nShadow Database Status:`);
    console.log(`  Environment:   ${env}`);
    console.log(`  Database Path: ${dbPath}`);
    console.log(`  Exists:        ${dbExists ? "Yes" : "No"}`);
    if (dbExists) {
      console.log(`  Size:          ${(sizeBytes / 1024).toFixed(2)} KB`);
      console.log(`  WAL Size:      ${(walSizeBytes / 1024).toFixed(2)} KB`);
      console.log(`  Integrity:     ${integrity.ok ? "Healthy (ok)" : `FAILED: ${integrity.message}`}`);
    }
    console.log();
  }
}
