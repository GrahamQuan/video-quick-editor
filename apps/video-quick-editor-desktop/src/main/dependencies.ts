import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { runProcess } from "@video-quick-editor/media-core";
import { dependencyStateSchema, type DependencyState } from "@video-quick-editor/shared";

export const requiredEncoders = ["libx264", "libx265", "aac"];
export const requiredFilters = [
  "drawtext",
  "concat",
  "scale",
  "pad",
  "fps",
  "trim",
  "setpts",
  "format",
  "setsar",
  "atrim",
  "asetpts",
  "aresample",
  "aformat",
  "apad",
  "anullsrc",
  "null",
];
export type ToolPaths = { ffmpegPath: string; ffprobePath: string };
type Tool = "ffmpeg" | "ffprobe";
const empty = (): DependencyState => ({ status: "checking", generation: 0, tools: [] });
export class Dependencies {
  private state = empty();
  private configured: ToolPaths = { ffmpegPath: "", ffprobePath: "" };
  private resolved: ToolPaths = { ffmpegPath: "", ffprobePath: "" };
  private generation = 0;
  private pending: { generation: number; promise: Promise<DependencyState> } | null = null;
  constructor(
    private emit: (state: DependencyState) => void = () => {},
    private options: {
      candidates?: (tool: Tool) => string[];
      timeoutMs?: number;
      run?: typeof runProcess;
    } = {},
  ) {}
  snapshot() {
    return dependencyStateSchema.parse(this.state);
  }
  configure(paths: ToolPaths) {
    this.configured = { ...paths };
    this.generation++;
    this.state = { ...empty(), generation: this.generation };
    this.emit(this.snapshot());
  }
  private async locate(tool: Tool, configured: string) {
    if (configured && isAbsolute(configured)) return configured;
    if (configured && configured.includes("/")) return configured; // invalid explicit path must not fall back
    const executable = configured || tool;
    const candidates = configured
      ? (process.env.PATH ?? "")
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, executable))
      : (this.options.candidates?.(tool) ?? [
          `/opt/homebrew/bin/${tool}`,
          `/usr/local/bin/${tool}`,
          `/usr/bin/${tool}`,
          ...(process.env.PATH ?? "")
            .split(delimiter)
            .filter(Boolean)
            .map((dir) => join(dir, tool)),
        ]);
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        /* next candidate */
      }
    }
    return candidates[0] ?? `/nonexistent/${tool}`;
  }
  check(): Promise<DependencyState> {
    if (this.pending?.generation === this.generation) return this.pending.promise;
    const generation = ++this.generation;
    const promise = this.inspect(generation, { ...this.configured });
    this.pending = { generation, promise };
    void promise
      .finally(() => {
        if (this.pending?.generation === generation) this.pending = null;
      })
      .catch(() => {});
    return promise;
  }
  private async inspect(generation: number, configured: ToolPaths): Promise<DependencyState> {
    this.state = { ...empty(), generation };
    this.emit(this.snapshot());
    const resolved: ToolPaths = {
      ffmpegPath: await this.locate("ffmpeg", configured.ffmpegPath),
      ffprobePath: await this.locate("ffprobe", configured.ffprobePath),
    };
    const tools = await Promise.all(
      (["ffmpeg", "ffprobe"] as const).map(async (tool) => {
        const result: DependencyState["tools"][number] = {
          tool,
          version: null,
          failures: [],
          missingEncoders: [],
          missingFilters: [],
        };
        const path = resolved[`${tool}Path`];
        try {
          await access(path);
        } catch {
          result.failures.push("not-found");
          return result;
        }
        try {
          await access(path, constants.X_OK);
        } catch {
          result.failures.push("not-executable");
          return result;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5000);
        const run = this.options.run ?? runProcess;
        try {
          const version = await run(path, ["-version"], { signal: controller.signal });
          const line = version.stdout.split("\n")[0] ?? "";
          if (!line.startsWith(`${tool} version `)) throw new Error("Unexpected executable");
          result.version = line;
          if (tool === "ffmpeg") {
            const capabilities = await Promise.allSettled([
              run(path, ["-hide_banner", "-encoders"], { signal: controller.signal }),
              run(path, ["-hide_banner", "-filters"], { signal: controller.signal }),
            ]);
            // Wait for both children so an early failure cannot cancel the timeout
            // while the other capability query is still running.
            const [encoders, filters] = capabilities.map((result) => {
              if (result.status === "rejected") throw result.reason;
              return result.value;
            });
            const names = (text: string) =>
              new Set(
                text
                  .split("\n")
                  // FFmpeg 9 uses two filter flags; older versions use three.
                  // Encoder rows still have six flags. Match whole names only.
                  .map((line) => /^\s*[A-Z.]{2,6}\s+(\S+)\s/.exec(line)?.[1])
                  .filter(Boolean),
              );
            const encoderNames = names(encoders!.stdout),
              filterNames = names(filters!.stdout);
            result.missingEncoders = requiredEncoders.filter((name) => !encoderNames.has(name));
            result.missingFilters = requiredFilters.filter((name) => !filterNames.has(name));
            if (result.missingEncoders.length) result.failures.push("missing-encoders");
            if (result.missingFilters.length) result.failures.push("missing-filters");
          }
        } catch {
          result.failures.push(controller.signal.aborted ? "timeout" : "start-failed");
        } finally {
          clearTimeout(timer);
        }
        return result;
      }),
    );
    if (generation !== this.generation) return this.check();
    this.resolved = resolved;
    this.state = {
      status: tools.every((tool) => !tool.failures.length) ? "ready" : "unavailable",
      generation,
      tools,
    };
    this.emit(this.snapshot());
    return this.snapshot();
  }
  async requireReady(): Promise<ToolPaths> {
    const state = await this.check();
    if (state.status !== "ready") throw new Error(this.error());
    return { ...this.resolved };
  }
  error() {
    return `TOOLS_UNAVAILABLE: ${
      this.state.status === "checking"
        ? "Checking dependencies / 正在检测依赖"
        : this.state.tools
            .filter((t) => t.failures.length)
            .map(
              (t) =>
                `${t.tool}: ${[...t.failures, ...t.missingEncoders, ...t.missingFilters].join(", ")}`,
            )
            .join("; ")
    }. Open Settings and check again / 请在设置中指定工具路径并重新检测`;
  }
  legacy() {
    return {
      available: this.state.status === "ready",
      ffmpegVersion: this.state.tools.find((t) => t.tool === "ffmpeg")?.version ?? null,
      ffprobeVersion: this.state.tools.find((t) => t.tool === "ffprobe")?.version ?? null,
      missing: this.state.status === "ready" ? [] : [this.error()],
    };
  }
}
