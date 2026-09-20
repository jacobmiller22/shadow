export interface ADFNode {
  type: string;
  attrs?: Record<string, any>;
  content?: ADFNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

export interface ADFDocument {
  version: number;
  type: "doc";
  content: ADFNode[];
}

export class ADFConverter {
  /**
   * Converts an Atlassian Document Format (ADF) JSON structure into standard Markdown text.
   */
  public static toMarkdown(doc: ADFDocument | ADFNode | null | undefined): string {
    if (!doc || !doc.content) return "";
    return this.renderNodes(doc.content).trim();
  }

  private static renderNodes(nodes: ADFNode[]): string {
    const parts: string[] = [];

    for (const node of nodes) {
      switch (node.type) {
        case "paragraph":
          parts.push(this.renderInline(node.content || "") + "\n\n");
          break;

        case "heading": {
          const level = node.attrs?.level || 1;
          const prefix = "#".repeat(level) + " ";
          parts.push(prefix + this.renderInline(node.content || "") + "\n\n");
          break;
        }

        case "bulletList":
          parts.push(this.renderList(node.content || [], false) + "\n");
          break;

        case "orderedList":
          parts.push(this.renderList(node.content || [], true) + "\n");
          break;

        case "codeBlock": {
          const lang = node.attrs?.language || "";
          const text = (node.content || []).map((c) => c.text || "").join("");
          parts.push(`\`\`\`${lang}\n${text}\n\`\`\`\n\n`);
          break;
        }

        case "blockquote":
          parts.push(
            (node.content || [])
              .map((c) => `> ${this.renderInline(c.content || "")}`)
              .join("\n") + "\n\n"
          );
          break;

        case "rule":
          parts.push("---\n\n");
          break;

        default:
          if (node.content) {
            parts.push(this.renderNodes(node.content));
          }
          break;
      }
    }

    return parts.join("");
  }

  private static renderInline(content: ADFNode[] | string): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
      .map((node) => {
        let text = node.text || "";
        if (!node.marks) return text;

        for (const mark of node.marks) {
          switch (mark.type) {
            case "strong":
              text = `**${text}**`;
              break;
            case "em":
              text = `*${text}*`;
              break;
            case "code":
              text = `\`${text}\``;
              break;
            case "link":
              text = `[${text}](${mark.attrs?.href || ""})`;
              break;
            case "strike":
              text = `~~${text}~~`;
              break;
          }
        }
        return text;
      })
      .join("");
  }

  private static renderList(items: ADFNode[], isOrdered: boolean): string {
    return items
      .map((item, idx) => {
        const bullet = isOrdered ? `${idx + 1}. ` : "- ";
        const text = (item.content || [])
          .map((c) => (c.type === "paragraph" ? this.renderInline(c.content || "") : ""))
          .join(" ")
          .trim();
        return `${bullet}${text}`;
      })
      .join("\n");
  }

  /**
   * Converts standard Markdown text into an Atlassian Document Format (ADF) JSON structure.
   */
  public static toADF(markdown: string): ADFDocument {
    if (!markdown || markdown.trim().length === 0) {
      return {
        version: 1,
        type: "doc",
        content: [{ type: "paragraph", content: [] }],
      };
    }

    const lines = markdown.split("\n");
    const docContent: ADFNode[] = [];
    let inCodeBlock = false;
    let codeBlockLang = "";
    let codeBlockLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code blocks
      if (line.trim().startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.trim().replace(/^```/, "").trim();
          codeBlockLines = [];
        } else {
          inCodeBlock = false;
          docContent.push({
            type: "codeBlock",
            attrs: codeBlockLang ? { language: codeBlockLang } : undefined,
            content: [{ type: "text", text: codeBlockLines.join("\n") }],
          });
          codeBlockLang = "";
          codeBlockLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      // Headings
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        docContent.push({
          type: "heading",
          attrs: { level },
          content: this.parseInlineText(text),
        });
        continue;
      }

      // Bullet lists
      const bulletMatch = trimmed.match(/^[-*+]\s+(.*)$/);
      if (bulletMatch) {
        const itemText = bulletMatch[1];
        docContent.push({
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: this.parseInlineText(itemText),
                },
              ],
            },
          ],
        });
        continue;
      }

      // Standard Paragraph
      docContent.push({
        type: "paragraph",
        content: this.parseInlineText(trimmed),
      });
    }

    return {
      version: 1,
      type: "doc",
      content: docContent.length > 0 ? docContent : [{ type: "paragraph", content: [] }],
    };
  }

  private static parseInlineText(text: string): ADFNode[] {
    const nodes: ADFNode[] = [];
    // Simple inline parser for bold, italic, code
    const regex = /(\*\*(.*?)\*\*|\*(.*?)\*|`(.*?)`|\[(.*?)\]\((.*?)\)|[^*`[]+)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const full = match[0];
      if (full.startsWith("**") && full.endsWith("**")) {
        nodes.push({
          type: "text",
          text: match[2],
          marks: [{ type: "strong" }],
        });
      } else if (full.startsWith("*") && full.endsWith("*")) {
        nodes.push({
          type: "text",
          text: match[3],
          marks: [{ type: "em" }],
        });
      } else if (full.startsWith("`") && full.endsWith("`")) {
        nodes.push({
          type: "text",
          text: match[4],
          marks: [{ type: "code" }],
        });
      } else if (full.startsWith("[") && match[5] && match[6]) {
        nodes.push({
          type: "text",
          text: match[5],
          marks: [{ type: "link", attrs: { href: match[6] } }],
        });
      } else if (full) {
        nodes.push({
          type: "text",
          text: full,
        });
      }
    }

    return nodes.length > 0 ? nodes : [{ type: "text", text }];
  }
}
