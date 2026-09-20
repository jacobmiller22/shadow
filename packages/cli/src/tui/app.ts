import readline from "node:readline";
import pc from "picocolors";
import type { Database } from "bun:sqlite";
import {
  TaskService,
  RemoteLinkService,
  GitContextResolver,
  type Task,
} from "@shadow/shared";

export type TuiView = "kanban" | "tree" | "inspector";

export class ShadowTuiApp {
  private db: Database;
  private taskService: TaskService;
  private linkService: RemoteLinkService;
  private activeView: TuiView = "kanban";
  private tasks: Task[] = [];
  private selectedColumn = 0; // 0: todo, 1: in_progress, 2: done
  private selectedIndex = 0;
  private showHelp = false;
  private isRunning = false;
  private statusMessage = "";
  private workspaceId?: string;

  constructor(db: Database, workspaceId?: string) {
    this.db = db;
    this.workspaceId = workspaceId;
    this.taskService = new TaskService(db);
    this.linkService = new RemoteLinkService(db);
  }

  public refresh(): void {
    const wsId = this.workspaceId || GitContextResolver.resolve().workspaceId;
    this.tasks = this.taskService.listTasks({
      workspaceId: wsId,
    });
  }

  public getColumnTasks(status: "todo" | "in_progress" | "done"): Task[] {
    return this.tasks.filter((t) => {
      if (status === "todo") return t.status === "todo" || t.status === "blocked";
      return t.status === status;
    });
  }

  public render(): string {
    const columns: Array<"todo" | "in_progress" | "done"> = ["todo", "in_progress", "done"];
    const width = process.stdout.columns || 100;
    const colWidth = Math.max(28, Math.floor((width - 6) / 3));

    const lines: string[] = [];

    // Header
    const headerTitle = pc.bold(pc.cyan("⚡ SHADOW TERMINAL UI"));
    const viewTabs = [
      this.activeView === "kanban" ? pc.black(pc.bgCyan(" 1. Kanban ")) : pc.dim(" 1. Kanban "),
      this.activeView === "tree" ? pc.black(pc.bgCyan(" 2. Hierarchy ")) : pc.dim(" 2. Hierarchy "),
      this.activeView === "inspector" ? pc.black(pc.bgCyan(" 3. Inspector ")) : pc.dim(" 3. Inspector "),
    ].join(" ");
    const helpHint = pc.dim("[Tab: switch view | Space: move | ?: help | q: quit]");
    lines.push(`${headerTitle}  ${viewTabs}  ${helpHint}`);
    lines.push(pc.dim("━".repeat(width - 2)));

    if (this.showHelp) {
      lines.push(pc.bold(pc.yellow("Keyboard Navigation:")));
      lines.push("  h / ←       : Move left column");
      lines.push("  l / →       : Move right column");
      lines.push("  j / ↓       : Select next card");
      lines.push("  k / ↑       : Select previous card");
      lines.push("  Space/Enter : Advance card status (Todo -> In Progress -> Done)");
      lines.push("  Tab         : Switch view (Kanban -> Hierarchy -> Inspector)");
      lines.push("  r           : Refresh from SQLite database");
      lines.push("  ?           : Toggle this help overlay");
      lines.push("  q / Ctrl+C  : Exit TUI");
      lines.push("");
      lines.push(pc.dim("Press '?' to close help overlay."));
      return lines.join("\n");
    }

    if (this.activeView === "kanban") {
      const todoTasks = this.getColumnTasks("todo");
      const inProgTasks = this.getColumnTasks("in_progress");
      const doneTasks = this.getColumnTasks("done");

      const colHeaders = [
        pc.bold(pc.yellow(`TODO (${todoTasks.length})`)),
        pc.bold(pc.cyan(`IN PROGRESS (${inProgTasks.length})`)),
        pc.bold(pc.green(`DONE (${doneTasks.length})`)),
      ];

      lines.push(
        colHeaders
          .map((h, i) => (i === this.selectedColumn ? pc.underline(h) : h).padEnd(colWidth))
          .join(" │ ")
      );
      lines.push(pc.dim("─".repeat(width - 2)));

      const maxRows = Math.max(todoTasks.length, inProgTasks.length, doneTasks.length, 1);
      const cols = [todoTasks, inProgTasks, doneTasks];

      for (let r = 0; r < Math.min(maxRows, 15); r++) {
        const rowCols = cols.map((colList, colIdx) => {
          const item = colList[r];
          if (!item) return " ".repeat(colWidth);

          const isSelected = colIdx === this.selectedColumn && r === this.selectedIndex;
          const links = this.linkService.getLinksForTask(item.id);
          const linkStr = links.length > 0 ? ` [${links[0].remoteKey}]` : "";

          const titleTrunc = item.title.slice(0, colWidth - 12);
          const itemStr = `${item.id}: ${titleTrunc}${linkStr}`;

          if (isSelected) {
            return pc.black(pc.bgWhite(` ► ${itemStr} `)).padEnd(colWidth);
          }
          return `   ${itemStr}`.padEnd(colWidth);
        });

        lines.push(rowCols.join(" │ "));
      }
    } else if (this.activeView === "tree") {
      lines.push(pc.bold("Hierarchical Task Tree & Remote Links:"));
      const rootTasks = this.tasks.filter((t) => !t.parentId);

      for (const root of rootTasks.slice(0, 15)) {
        const links = this.linkService.getLinksForTask(root.id);
        const linkTag = links.length > 0 ? pc.magenta(` [${links[0].remoteKey}]`) : "";
        const statusTag = root.status === "done" ? pc.green("✓") : pc.yellow("○");
        lines.push(`  ${statusTag} ${pc.bold(root.id)}: ${root.title}${linkTag}`);

        const children = this.tasks.filter((t) => t.parentId === root.id);
        for (const child of children) {
          const cLinks = this.linkService.getLinksForTask(child.id);
          const cLinkTag = cLinks.length > 0 ? pc.magenta(` [${cLinks[0].remoteKey}]`) : "";
          const cStatusTag = child.status === "done" ? pc.green("✓") : pc.yellow("○");
          lines.push(`     └── ${cStatusTag} ${child.id}: ${child.title}${cLinkTag}`);
        }
      }
    } else if (this.activeView === "inspector") {
      const activeCol = columns[this.selectedColumn];
      const activeList = this.getColumnTasks(activeCol);
      const selectedTask = activeList[this.selectedIndex] || this.tasks[0];

      if (!selectedTask) {
        lines.push(pc.dim("No task selected."));
      } else {
        const links = this.linkService.getLinksForTask(selectedTask.id);
        lines.push(pc.bold(pc.cyan(`Task Detail Inspector: ${selectedTask.id}`)));
        lines.push(`  Title      : ${pc.bold(selectedTask.title)}`);
        lines.push(`  Status     : ${selectedTask.status}`);
        lines.push(`  Priority   : ${selectedTask.priority}`);
        lines.push(`  Branch     : ${selectedTask.branch || "none"}`);
        lines.push(`  Workspace  : ${selectedTask.workspaceId}`);
        lines.push(`  Description: ${selectedTask.description || pc.dim("(none)")}`);
        lines.push(`  Remote Links:`);
        if (links.length === 0) {
          lines.push(`    ${pc.dim("(no remote links)")}`);
        } else {
          for (const l of links) {
            lines.push(`    • ${pc.magenta(l.remoteSystem + ":" + l.remoteKey)} (synced: ${new Date(l.lastSyncedAt).toLocaleString()})`);
          }
        }
      }
    }

    // Status bar
    lines.push(pc.dim("━".repeat(width - 2)));
    const msg = this.statusMessage || `Workspace tasks: ${this.tasks.length} loaded.`;
    lines.push(pc.cyan(`⚡ ${msg}`));

    return lines.join("\n");
  }

  public advanceSelectedTask(): void {
    const columns: Array<"todo" | "in_progress" | "done"> = ["todo", "in_progress", "done"];
    const activeCol = columns[this.selectedColumn];
    const activeList = this.getColumnTasks(activeCol);
    const item = activeList[this.selectedIndex];
    if (!item) return;

    let nextStatus: "in_progress" | "done" = "in_progress";
    if (item.status === "todo" || item.status === "blocked") {
      nextStatus = "in_progress";
    } else if (item.status === "in_progress") {
      nextStatus = "done";
    } else {
      nextStatus = "in_progress";
    }

    try {
      this.taskService.updateTask(item.id, { status: nextStatus });
      this.statusMessage = `Moved ${item.id} to ${nextStatus}`;
      if (nextStatus === "in_progress") {
        this.selectedColumn = 1;
      } else if (nextStatus === "done") {
        this.selectedColumn = 2;
      }
      this.selectedIndex = 0;
      this.refresh();
    } catch (err: any) {
      this.statusMessage = `Error: ${err.message}`;
    }
  }

  public selectColumn(col: number): void {
    this.selectedColumn = Math.max(0, Math.min(col, 2));
    this.selectedIndex = 0;
  }

  public async start(): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.refresh();
      console.log(this.render());
      return;
    }

    this.isRunning = true;
    this.refresh();

    // Enter alternate screen buffer & hide cursor
    process.stdout.write("\x1b[?1049h\x1b[?25l");
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    const draw = () => {
      // Clear screen and redraw
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(this.render());
    };

    draw();

    return new Promise((resolve) => {
      const onKeypress = (_str: string, key: readline.Key) => {
        if (!this.isRunning) return;

        if (key.ctrl && key.name === "c") {
          cleanup();
          return;
        }

        switch (key.name) {
          case "q":
            cleanup();
            return;
          case "tab":
            if (this.activeView === "kanban") this.activeView = "tree";
            else if (this.activeView === "tree") this.activeView = "inspector";
            else this.activeView = "kanban";
            break;
          case "?":
            this.showHelp = !this.showHelp;
            break;
          case "r":
            this.refresh();
            this.statusMessage = "Refreshed tasks from database.";
            break;
          case "h":
          case "left":
            this.selectedColumn = (this.selectedColumn + 2) % 3;
            this.selectedIndex = 0;
            break;
          case "l":
          case "right":
            this.selectedColumn = (this.selectedColumn + 1) % 3;
            this.selectedIndex = 0;
            break;
          case "j":
          case "down": {
            const cols: Array<"todo" | "in_progress" | "done"> = ["todo", "in_progress", "done"];
            const list = this.getColumnTasks(cols[this.selectedColumn]);
            if (this.selectedIndex < list.length - 1) {
              this.selectedIndex++;
            }
            break;
          }
          case "k":
          case "up":
            if (this.selectedIndex > 0) {
              this.selectedIndex--;
            }
            break;
          case "space":
          case "return":
            this.advanceSelectedTask();
            break;
        }

        draw();
      };

      const cleanup = () => {
        this.isRunning = false;
        process.stdin.removeListener("keypress", onKeypress);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        // Leave alternate screen buffer & show cursor
        process.stdout.write("\x1b[?1049l\x1b[?25h");
        resolve();
      };

      process.stdin.on("keypress", onKeypress);
    });
  }
}
