export interface JiraTransition {
  id: string;
  name: string;
  to: {
    name: string;
    id?: string;
  };
}

export interface StatusMatrixConfig {
  [localStatus: string]: string; // e.g. "done": "Done", "in_progress": "In Progress"
}

export const DEFAULT_STATUS_MATRIX: StatusMatrixConfig = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
  blocked: "Blocked",
};

export class JiraStatusTransitionEngine {
  private matrix: StatusMatrixConfig;

  constructor(customMatrix?: StatusMatrixConfig) {
    this.matrix = { ...DEFAULT_STATUS_MATRIX, ...(customMatrix || {}) };
  }

  /**
   * Resolves the matching Jira transition ID for a given local status from available transitions.
   */
  public resolveTransition(
    localStatus: string,
    availableTransitions: JiraTransition[]
  ): JiraTransition | null {
    const targetStatusName = this.matrix[localStatus]?.toLowerCase();
    if (!targetStatusName) return null;

    // 1. Try matching destination status name directly (e.g. to.name === "Done")
    const matchByTo = availableTransitions.find(
      (t) => t.to?.name?.toLowerCase() === targetStatusName
    );
    if (matchByTo) return matchByTo;

    // 2. Try matching transition action name directly (e.g. name === "Done" or "Start Progress")
    const matchByName = availableTransitions.find(
      (t) => t.name.toLowerCase() === targetStatusName
    );
    if (matchByName) return matchByName;

    // 3. Fallback fuzzy search (e.g. contains target status name)
    const fuzzy = availableTransitions.find(
      (t) =>
        t.to?.name?.toLowerCase().includes(targetStatusName) ||
        t.name.toLowerCase().includes(targetStatusName)
    );
    return fuzzy || null;
  }
}
