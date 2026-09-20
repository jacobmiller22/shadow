export interface ChecklistItem {
  index: number;
  text: string;
  checked: boolean;
  rawLine: string;
}

export interface ChecklistReport {
  total: number;
  completed: number;
  remaining: number;
  percent: number;
  items: ChecklistItem[];
  allCompleted: boolean;
}

export class ChecklistService {
  private static CHECKLIST_REGEX = /^(\s*[-*+]\s+\[([ xX])\]\s+(.*))$/;

  /**
   * Parses all markdown checklist checkboxes from text.
   */
  public static parse(content: string): ChecklistReport {
    if (!content) {
      return { total: 0, completed: 0, remaining: 0, percent: 100, items: [], allCompleted: true };
    }

    const lines = content.split("\n");
    const items: ChecklistItem[] = [];
    let itemIndex = 0;

    for (const line of lines) {
      const match = line.match(this.CHECKLIST_REGEX);
      if (match) {
        const isChecked = match[2].toLowerCase() === "x";
        const itemText = match[3].trim();
        items.push({
          index: itemIndex++,
          text: itemText,
          checked: isChecked,
          rawLine: line,
        });
      }
    }

    const total = items.length;
    const completed = items.filter((i) => i.checked).length;
    const remaining = total - completed;
    const percent = total === 0 ? 100 : Math.round((completed / total) * 100);

    return {
      total,
      completed,
      remaining,
      percent,
      items,
      allCompleted: remaining === 0,
    };
  }

  /**
   * Checks if content contains any uncompleted checklist items.
   */
  public static hasUncheckedItems(content: string): boolean {
    const report = this.parse(content);
    return report.remaining > 0;
  }

  /**
   * Toggles or checks a checklist item by index (0-based) or matching substring.
   */
  public static checkItem(content: string, targetIndexOrText: number | string, setChecked: boolean = true): string {
    const lines = content.split("\n");
    let currentIdx = 0;

    const modified = lines.map((line) => {
      const match = line.match(this.CHECKLIST_REGEX);
      if (!match) return line;

      const idx = currentIdx++;
      const text = match[3].trim();

      let shouldModify = false;
      if (typeof targetIndexOrText === "number") {
        shouldModify = idx === targetIndexOrText;
      } else {
        shouldModify = text.toLowerCase().includes(targetIndexOrText.toLowerCase());
      }

      if (shouldModify) {
        const mark = setChecked ? "x" : " ";
        // Rebuild line with new checkmark
        return line.replace(/\[([ xX])\]/, `[${mark}]`);
      }
      return line;
    });

    return modified.join("\n");
  }
}
