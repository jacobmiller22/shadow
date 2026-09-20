export type ConflictStrategy = "ours" | "theirs" | "prompt";

export interface SyncEntity {
  id: string;
  updatedAt: number;
  [key: string]: any;
}

export type ConflictResolutionAction =
  | { action: "fast-forward-remote"; payload: Record<string, any> }
  | { action: "fast-forward-local"; payload: Record<string, any> }
  | { action: "no-op" }
  | { action: "conflict"; reason: string; resolvedPayload: Record<string, any> };

export class ConflictResolver {
  /**
   * Evaluates 3-way differences between local, remote, and baseline last-synced timestamp.
   */
  public static reconcile(
    local: SyncEntity,
    remote: SyncEntity,
    lastSyncedAt: number,
    strategy: ConflictStrategy = "theirs"
  ): ConflictResolutionAction {
    const localChanged = local.updatedAt > lastSyncedAt;
    const remoteChanged = remote.updatedAt > lastSyncedAt;

    // Case 1: Neither changed
    if (!localChanged && !remoteChanged) {
      return { action: "no-op" };
    }

    // Case 2: Only local changed -> push local to remote
    if (localChanged && !remoteChanged) {
      return {
        action: "fast-forward-remote",
        payload: local,
      };
    }

    // Case 3: Only remote changed -> pull remote to local
    if (!localChanged && remoteChanged) {
      return {
        action: "fast-forward-local",
        payload: remote,
      };
    }

    // Case 4: BOTH changed -> 3-way conflict!
    const reason = `Simultaneous modification detected on task ${local.id} (local updated at ${local.updatedAt}, remote updated at ${remote.updatedAt}, last synced at ${lastSyncedAt})`;

    if (strategy === "ours") {
      return {
        action: "conflict",
        reason: `${reason} - Resolved with 'ours' strategy (local wins)`,
        resolvedPayload: local,
      };
    } else {
      // Default: "theirs"
      return {
        action: "conflict",
        reason: `${reason} - Resolved with 'theirs' strategy (remote wins)`,
        resolvedPayload: remote,
      };
    }
  }
}
