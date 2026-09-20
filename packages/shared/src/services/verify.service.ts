import { spawnSync } from "node:child_process";

export interface VerificationResult {
  success: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class VerificationService {
  /**
   * Executes a verification command in the current environment with timeout protection.
   */
  public static execute(
    command: string,
    cwd: string = process.cwd(),
    timeoutMs: number = 60000
  ): VerificationResult {
    const start = Date.now();

    const result = spawnSync(command, {
      shell: true,
      cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      env: { ...process.env },
    });

    const durationMs = Date.now() - start;
    const exitCode = result.status ?? (result.signal ? 128 : 1);
    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();

    return {
      success: exitCode === 0,
      command,
      exitCode,
      stdout,
      stderr,
      durationMs,
    };
  }
}
