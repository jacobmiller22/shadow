import type { Task } from "../db/schema";
import { ADFConverter, type ADFDocument } from "./adf";

export interface RollupItem {
  task: Task;
  checklistTotal?: number;
  checklistCompleted?: number;
  blockers?: string[];
}

export interface RollupSummary {
  remoteKey: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  percentComplete: number;
  markdown: string;
  adf: ADFDocument;
}

export class RollupGenerator {
  /**
   * Generates a synthesized status rollup for a Jira issue from N local tasks.
   */
  public static generate(
    remoteKey: string,
    items: RollupItem[],
    options: { includeCommitShas?: boolean } = {}
  ): RollupSummary {
    const total = items.length;
    if (total === 0) {
      const emptyMd = `### 📊 Shadow Rollup for **${remoteKey}**\n\n*No local tasks linked.*`;
      return {
        remoteKey,
        totalTasks: 0,
        completedTasks: 0,
        inProgressTasks: 0,
        percentComplete: 0,
        markdown: emptyMd,
        adf: ADFConverter.toADF(emptyMd),
      };
    }

    let completed = 0;
    let inProgress = 0;
    const blockers: string[] = [];

    for (const item of items) {
      if (item.task.status === "done") {
        completed++;
      } else if (item.task.status === "in_progress") {
        inProgress++;
      }

      if (item.task.status === "blocked") {
        blockers.push(`Task **${item.task.id}** (${item.task.title}) is currently blocked.`);
      }
      if (item.blockers && item.blockers.length > 0) {
        for (const b of item.blockers) {
          blockers.push(`Task **${item.task.id}**: ${b}`);
        }
      }
    }

    const percent = Math.round((completed / total) * 100);

    // Build Markdown
    const lines: string[] = [];
    lines.push(`### 🚀 Shadow Task Rollup: **${remoteKey}**\n`);
    lines.push(`**Progress:** ${percent}% (${completed}/${total} completed, ${inProgress} in progress)\n`);

    // Task Checklist
    lines.push(`#### 📋 Linked Task Checklist`);
    for (const item of items) {
      const isDone = item.task.status === "done";
      const marker = isDone ? "[x]" : "[ ]";
      const branchStr = item.task.branch ? ` \`branch: ${item.task.branch}\`` : "";
      lines.push(`- ${marker} **${item.task.id}**: ${item.task.title} *(status: ${item.task.status})*${branchStr}`);
    }
    lines.push("");

    // Blockers section
    if (blockers.length > 0) {
      lines.push(`#### ⚠️ Active Blockers`);
      for (const b of blockers) {
        lines.push(`- ${b}`);
      }
      lines.push("");
    }

    const markdown = lines.join("\n");
    const adf = ADFConverter.toADF(markdown);

    return {
      remoteKey,
      totalTasks: total,
      completedTasks: completed,
      inProgressTasks: inProgress,
      percentComplete: percent,
      markdown,
      adf,
    };
  }
}
