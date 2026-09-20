import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { EnvironmentResolver } from "./env";

export interface BackupFileInfo {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
}

export class BackupService {
  /**
   * Runs an atomic integrity check on the SQLite database.
   * Returns true if database is healthy ("ok"), or error string if corrupted.
   */
  public static checkIntegrity(db: Database): { ok: boolean; message: string } {
    try {
      const result = db.query("PRAGMA integrity_check;").get() as any;
      const status = typeof result === "object" ? Object.values(result)[0] : result;
      if (String(status).toLowerCase() === "ok") {
        return { ok: true, message: "ok" };
      }
      return { ok: false, message: String(status) };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Integrity check failed" };
    }
  }

  /**
   * Resolves the backup directory inside the storage location.
   */
  public static getBackupDirectory(storageDir?: string): string {
    const base = storageDir || EnvironmentResolver.resolveStorageDirectory();
    const backupDir = path.join(base, "backups");
    EnvironmentResolver.ensureDirectory(backupDir);
    return backupDir;
  }

  /**
   * Creates an atomic non-blocking snapshot of the database using VACUUM INTO.
   */
  public static createSnapshot(db: Database, customBackupDir?: string): BackupFileInfo {
    const backupDir = this.getBackupDirectory(customBackupDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFileName = `shadow_backup_${timestamp}.db`;
    const targetPath = path.join(backupDir, backupFileName);

    // VACUUM INTO creates an atomic, consistent, compacted snapshot while live
    db.exec(`VACUUM INTO '${targetPath}';`);

    const stats = fs.statSync(targetPath);
    // Auto-prune old backups according to retention policy
    this.pruneBackups(backupDir);

    return {
      filePath: targetPath,
      fileName: backupFileName,
      sizeBytes: stats.size,
      createdAt: stats.birthtime || stats.mtime,
    };
  }

  /**
   * Lists all existing backup snapshots ordered by newest first.
   */
  public static listSnapshots(customBackupDir?: string): BackupFileInfo[] {
    const backupDir = this.getBackupDirectory(customBackupDir);
    if (!fs.existsSync(backupDir)) return [];

    const files = fs.readdirSync(backupDir);
    const backups: BackupFileInfo[] = [];

    for (const file of files) {
      if (file.startsWith("shadow_backup_") && file.endsWith(".db")) {
        const fullPath = path.join(backupDir, file);
        try {
          const stats = fs.statSync(fullPath);
          backups.push({
            filePath: fullPath,
            fileName: file,
            sizeBytes: stats.size,
            createdAt: stats.birthtime || stats.mtime,
          });
        } catch {
          // Ignore files that cannot be read
        }
      }
    }

    return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Enforces backup retention policy:
   * Retain snapshots from the last 7 days; prune older snapshots.
   */
  public static pruneBackups(backupDir: string, maxAgeDays: number = 7): number {
    const snapshots = this.listSnapshots(backupDir);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let prunedCount = 0;

    for (const snap of snapshots) {
      if (snap.createdAt.getTime() < cutoff) {
        try {
          fs.unlinkSync(snap.filePath);
          prunedCount++;
        } catch {
          // Ignore deletion error
        }
      }
    }

    return prunedCount;
  }

  /**
   * Restores the database from a specified snapshot file.
   * Backs up the current file before performing atomic overwrite.
   */
  public static restoreFromSnapshot(sourceSnapshotPath: string, targetDbPath: string): void {
    if (!fs.existsSync(sourceSnapshotPath)) {
      throw new Error(`Snapshot file not found: ${sourceSnapshotPath}`);
    }

    // Verify source snapshot integrity before restoring
    const tempDb = new Database(sourceSnapshotPath, { readonly: true });
    const check = this.checkIntegrity(tempDb);
    tempDb.close();

    if (!check.ok) {
      throw new Error(`Cannot restore corrupted snapshot: ${check.message}`);
    }

    // Safety backup of the currently active DB if it exists
    if (fs.existsSync(targetDbPath)) {
      const safetyBackup = `${targetDbPath}.pre-restore-${Date.now()}`;
      fs.copyFileSync(targetDbPath, safetyBackup);
    }

    // Remove old WAL and SHM files to prevent state conflict
    const walPath = `${targetDbPath}-wal`;
    const shmPath = `${targetDbPath}-shm`;
    if (fs.existsSync(walPath)) {
      try { fs.unlinkSync(walPath); } catch {}
    }
    if (fs.existsSync(shmPath)) {
      try { fs.unlinkSync(shmPath); } catch {}
    }

    // Copy snapshot to target path
    fs.copyFileSync(sourceSnapshotPath, targetDbPath);
  }
}
