import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ExecutionPlan } from "./planner.js";
import { runProcess } from "./process.js";
import { verifyOutput } from "./probe.js";

export async function executePlan(options: {
  ffmpegPath: string;
  ffprobePath: string;
  plan: ExecutionPlan;
  tempDirectory: string;
  replaceAuthorized: boolean;
  signal: AbortSignal;
  beforePublish?: () => Promise<void>;
  resolveOutputConflict?: () => Promise<string>;
  onPhase: (phase: string, progress: number | null) => void;
}): Promise<void> {
  const { plan, tempDirectory, signal, onPhase } = options;
  const totalWorkUs = plan.commands.reduce(
    (total, command) => total + command.expectedDurationUs,
    0,
  );
  let completedWorkUs = 0;
  await mkdir(dirname(plan.tempOutputPath), { recursive: true });
  try {
    if (plan.mode === "copy") {
      const segmentPaths = plan.commands.slice(0, -1).map((command) => command.args.at(-1)!);
      const manifest = [
        "ffconcat version 1.0",
        ...segmentPaths.map((path) => `file '${basename(path).replaceAll("'", "'\\''")}'`),
      ].join("\n");
      await writeFile(join(tempDirectory, "segments.ffconcat"), manifest, "utf8");
    }
    for (let index = 0; index < plan.commands.length; index += 1) {
      const command = plan.commands[index]!;
      onPhase(command.label, (completedWorkUs / totalWorkUs) * 0.97);
      let pending = "";
      await runProcess(
        options.ffmpegPath,
        [...command.args.slice(0, -1), "-progress", "pipe:1", "-nostats", command.args.at(-1)!],
        {
          signal,
          onStdout(chunk) {
            pending += chunk;
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              const [key, value] = line.split("=", 2);
              if (key === "out_time_us") {
                const currentWorkUs = Math.min(command.expectedDurationUs, Number(value));
                const overall = ((completedWorkUs + currentWorkUs) / totalWorkUs) * 0.97;
                if (Number.isFinite(overall)) onPhase(command.label, overall);
              }
            }
          },
        },
      );
      completedWorkUs += command.expectedDurationUs;
      onPhase(command.label, (completedWorkUs / totalWorkUs) * 0.97);
    }
    onPhase("验证输出媒体", 0.98);
    await verifyOutput(options.ffprobePath, plan.tempOutputPath, plan.outputProfile, plan.hasAudio);
    signal.throwIfAborted();
    onPhase("发布文件", 0.99);
    await options.beforePublish?.();
    signal.throwIfAborted();
    if (options.replaceAuthorized) {
      await rename(plan.tempOutputPath, plan.finalOutputPath);
    } else {
      for (;;) {
        signal.throwIfAborted();
        try {
          await link(plan.tempOutputPath, plan.finalOutputPath);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !options.resolveOutputConflict)
            throw error;
          plan.finalOutputPath = await options.resolveOutputConflict();
        }
      }
      await rm(plan.tempOutputPath, { force: true });
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
