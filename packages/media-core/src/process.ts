import { spawn } from "node:child_process";

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export async function runProcess(
  executable: string,
  args: string[],
  options: { signal?: AbortSignal; onStdout?: (chunk: string) => void; stderrLimit?: number } = {},
): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const limit = options.stderrLimit ?? 64_000;
    let forceTimer: NodeJS.Timeout | undefined;
    const abort = (): void => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-limit);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (forceTimer) clearTimeout(forceTimer);
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) return reject(new DOMException("任务已取消", "AbortError"));
      if (code !== 0)
        return reject(new Error(`${executable} 失败 (${code ?? signal}): ${stderr.trim()}`));
      resolve({ stdout, stderr });
    });
  });
}
