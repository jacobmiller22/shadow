import pc from "picocolors";
import {
  type Task,
  type TaskTreeNode,
  UncompletedChecklistError,
  VerificationFailedError,
  LockCollisionError,
  CycleError,
} from "@shadow/shared";

export interface FormatterOptions {
  json?: boolean;
}

export class ExitCodes {
  public static SUCCESS = 0;
  public static GENERAL_ERROR = 1;
  public static VALIDATION_FAILED = 2;
  public static VERIFICATION_FAILED = 3;
  public static LOCK_COLLISION = 4;
}

export class OutputFormatter {
  public static isJsonMode(options?: FormatterOptions): boolean {
    if (options?.json) return true;
    if (process.env.SHADOW_OUTPUT === "json") return true;
    return false;
  }

  public static formatStatus(status: string): string {
    switch (status) {
      case "todo":
        return pc.yellow("○ todo");
      case "in_progress":
        return pc.cyan("◐ in_progress");
      case "blocked":
        return pc.red("✕ blocked");
      case "done":
        return pc.green("✓ done");
      case "cancelled":
        return pc.dim("⊘ cancelled");
      default:
        return status;
    }
  }

  public static formatPriority(priority: string): string {
    switch (priority) {
      case "critical":
        return pc.red(pc.bold("CRITICAL"));
      case "high":
        return pc.magenta("HIGH");
      case "medium":
        return pc.yellow("MED");
      case "low":
        return pc.blue("LOW");
      default:
        return priority.toUpperCase();
    }
  }

  public static printTask(task: Task & { isDeduplicated?: boolean }, options?: FormatterOptions): void {
    if (this.isJsonMode(options)) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }

    console.log();
    const dedupBadge = task.isDeduplicated ? pc.dim(" (deduplicated)") : "";
    console.log(`${pc.bold(task.id)}: ${pc.bold(pc.white(task.title))}${dedupBadge}`);
    console.log(pc.dim("─".repeat(60)));
    console.log(`  ${pc.bold("Status:")}     ${this.formatStatus(task.status)}`);
    console.log(`  ${pc.bold("Priority:")}   ${this.formatPriority(task.priority)}`);
    if (task.parentId) {
      console.log(`  ${pc.bold("Parent:")}     ${task.parentId}`);
    }
    if (task.branch) {
      console.log(`  ${pc.bold("Branch:")}     ${pc.dim(task.branch)}`);
    }
    console.log(`  ${pc.bold("Workspace:")}  ${pc.dim(task.workspaceId)}`);
    console.log(
      `  ${pc.bold("Created:")}    ${pc.dim(new Date(task.createdAt).toLocaleString())}`
    );
    if (task.completedAt) {
      console.log(
        `  ${pc.bold("Completed:")}  ${pc.dim(new Date(task.completedAt).toLocaleString())}`
      );
    }
    if (task.description) {
      console.log();
      console.log(pc.bold("  Description:"));
      const indented = task.description
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
      console.log(pc.dim(indented));
    }
    console.log();
  }

  public static printTaskList(tasks: Task[], options?: FormatterOptions): void {
    if (this.isJsonMode(options)) {
      console.log(JSON.stringify(tasks, null, 2));
      return;
    }

    if (tasks.length === 0) {
      console.log(pc.dim("No tasks found matching criteria."));
      return;
    }

    console.log();
    const idWidth = 10;
    const prioWidth = 10;
    const statusWidth = 15;

    console.log(
      pc.dim(
        `${"ID".padEnd(idWidth)}${"PRIORITY".padEnd(prioWidth)}${"STATUS".padEnd(statusWidth)}TITLE`
      )
    );
    console.log(pc.dim("─".repeat(70)));

    for (const task of tasks) {
      const id = pc.bold(task.id.padEnd(idWidth));
      const prio = this.formatPriority(task.priority).padEnd(prioWidth + (task.priority === "critical" ? 9 : 9));
      const stat = this.formatStatus(task.status).padEnd(statusWidth + 9);
      console.log(`${id} ${prio} ${stat} ${task.title}`);
    }
    console.log();
    console.log(pc.dim(`Total: ${tasks.length} task(s)`));
    console.log();
  }

  public static printTaskTree(nodes: TaskTreeNode[], options?: FormatterOptions, indent: string = ""): void {
    if (this.isJsonMode(options)) {
      console.log(JSON.stringify(nodes, null, 2));
      return;
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isLast = i === nodes.length - 1;
      const branchChar = isLast ? "└── " : "├── ";
      const nextIndent = indent + (isLast ? "    " : "│   ");

      console.log(
        `${indent}${branchChar}${pc.bold(node.id)} [${this.formatStatus(node.status)}] ${pc.bold(node.title)}`
      );

      if (node.children && node.children.length > 0) {
        this.printTaskTree(node.children, options, nextIndent);
      }
    }
  }

  public static printSuccess(message: string, options?: FormatterOptions, data?: any): void {
    if (this.isJsonMode(options)) {
      console.log(JSON.stringify({ success: true, message, data }, null, 2));
      return;
    }
    console.log(`${pc.green("✓")} ${message}`);
  }

  public static printError(error: any, options?: FormatterOptions): number {
    let exitCode = ExitCodes.GENERAL_ERROR;
    let codeName = "GENERAL_ERROR";
    let message = error instanceof Error ? error.message : String(error);
    let details: any = undefined;

    if (error instanceof UncompletedChecklistError) {
      exitCode = ExitCodes.VALIDATION_FAILED;
      codeName = "VALIDATION_FAILED";
      details = {
        remaining: error.report.remaining,
        total: error.report.total,
        uncheckedItems: error.report.items.filter((i) => !i.checked).map((i) => i.text),
      };
    } else if (error instanceof VerificationFailedError) {
      exitCode = ExitCodes.VERIFICATION_FAILED;
      codeName = "VERIFICATION_FAILED";
      details = {
        command: error.result.command,
        exitCode: error.result.exitCode,
        stdout: error.result.stdout,
        stderr: error.result.stderr,
      };
    } else if (error instanceof LockCollisionError) {
      exitCode = ExitCodes.LOCK_COLLISION;
      codeName = "LOCK_COLLISION";
      details = {
        workerId: error.workerId,
        remainingSeconds: error.remainingSeconds,
      };
    } else if (error instanceof CycleError) {
      exitCode = ExitCodes.VALIDATION_FAILED;
      codeName = "CYCLE_ERROR";
    }

    process.exitCode = exitCode;

    if (this.isJsonMode(options)) {
      console.error(
        JSON.stringify(
          {
            success: false,
            code: codeName,
            exitCode,
            error: message,
            details,
          },
          null,
          2
        )
      );
    } else {
      console.error(`${pc.red("Error:")} ${message}`);
      if (details?.uncheckedItems) {
        console.error(pc.yellow("Remaining unchecked items:"));
        for (const item of details.uncheckedItems) {
          console.error(pc.yellow(`  - [ ] ${item}`));
        }
      }
      if (details?.stderr) {
        console.error(pc.red(`Command output:\n${details.stderr}`));
      }
    }

    return exitCode;
  }
}
