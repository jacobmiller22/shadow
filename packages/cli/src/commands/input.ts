import fs from "node:fs";

export class InputResolver {
  /**
   * Reads task description or markdown body from:
   * 1. Inline flag string
   * 2. File path (--body-file <path>)
   * 3. Standard input if body-file is '-'
   */
  public static async resolveBody(
    inlineDesc?: string,
    bodyFilePath?: string
  ): Promise<string | undefined> {
    if (bodyFilePath) {
      if (bodyFilePath === "-") {
        // Read from standard input
        return new Promise((resolve, reject) => {
          let content = "";
          process.stdin.setEncoding("utf-8");
          process.stdin.on("data", (chunk) => {
            content += chunk;
          });
          process.stdin.on("end", () => {
            resolve(content.trim() || undefined);
          });
          process.stdin.on("error", (err) => {
            reject(err);
          });
        });
      }

      if (!fs.existsSync(bodyFilePath)) {
        throw new Error(`Body file not found: ${bodyFilePath}`);
      }
      return fs.readFileSync(bodyFilePath, "utf-8").trim();
    }

    return inlineDesc?.trim();
  }
}
