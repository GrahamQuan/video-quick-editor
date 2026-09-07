import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import {
  allocateOutputPath,
  assertOutputNotInput,
  createExecutionPlan,
  defaultOutputName,
  executePlan,
  probeAsset,
  runProcess,
  secondsArg,
  type ExecutionPlan,
  type ProbedAsset,
  type ResolvedClip,
} from "@video-quick-editor/media-core";
import {
  exportRequestSchema,
  settingsSchema,
  watermarkSchema,
  type ExportJob,
  type ExportPlanView,
  type ExportRequest,
  type OutputSelection,
  type Settings,
} from "@video-quick-editor/shared";
import { z } from "zod";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const assets = new Map<string, ProbedAsset>();
const fonts = new Map<string, string>();
const outputSelections = new Map<string, { path: string; replaceAuthorized: boolean }>();
const mediaFiles = new Map<string, string>();
const jobs: ExportJob[] = [];
const controllers = new Map<string, AbortController>();
const terminalJobStates = new Set<ExportJob["state"]>(["completed", "failed", "cancelled"]);
let mainWindow: BrowserWindow | null = null;
let allowQuit = false;

interface PersistedSettings {
  ffmpegPath: string;
  ffprobePath: string;
  defaultFontId: string | null;
  fonts: Record<string, string>;
}
let persisted: PersistedSettings = {
  ffmpegPath: "",
  ffprobePath: "",
  defaultFontId: null,
  fonts: {},
};
let toolStatus: Settings["toolStatus"] = {
  available: false,
  ffmpegVersion: null,
  ffprobeVersion: null,
  missing: ["尚未检测"],
};

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

async function loadSettings(): Promise<void> {
  try {
    const value = z
      .object({
        ffmpegPath: z.string(),
        ffprobePath: z.string(),
        defaultFontId: z.string().uuid().nullable(),
        fonts: z.record(z.string(), z.string()),
      })
      .parse(JSON.parse(await readFile(settingsPath(), "utf8")) as unknown);
    persisted = value;
    for (const [id, path] of Object.entries(value.fonts)) fonts.set(id, path);
  } catch {
    /* first run or invalid settings */
  }
  persisted.ffmpegPath ||= await discoverTool("ffmpeg");
  persisted.ffprobePath ||= await discoverTool("ffprobe");
}

async function saveSettings(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  persisted.fonts = Object.fromEntries(fonts);
  await writeFile(settingsPath(), JSON.stringify(persisted, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function discoverTool(name: "ffmpeg" | "ffprobe"): Promise<string> {
  const candidates = [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return name;
}

async function checkTools(): Promise<Settings["toolStatus"]> {
  const missing: string[] = [];
  let ffmpegVersion: string | null = null;
  let ffprobeVersion: string | null = null;
  try {
    const [version, encoders, filters] = await Promise.all([
      runProcess(persisted.ffmpegPath, ["-version"]),
      runProcess(persisted.ffmpegPath, ["-hide_banner", "-encoders"]),
      runProcess(persisted.ffmpegPath, ["-hide_banner", "-filters"]),
    ]);
    ffmpegVersion = version.stdout.split("\n")[0] ?? null;
    for (const encoder of ["libx264", "libx265", "aac"])
      if (!encoders.stdout.includes(encoder)) missing.push(`encoder:${encoder}`);
    for (const filter of ["drawtext", "concat", "scale", "pad", "fps"])
      if (!filters.stdout.includes(filter)) missing.push(`filter:${filter}`);
  } catch (error) {
    missing.push(`ffmpeg: ${message(error)}`);
  }
  try {
    ffprobeVersion =
      (await runProcess(persisted.ffprobePath, ["-version"])).stdout.split("\n")[0] ?? null;
  } catch (error) {
    missing.push(`ffprobe: ${message(error)}`);
  }
  toolStatus = { available: missing.length === 0, ffmpegVersion, ffprobeVersion, missing };
  return toolStatus;
}

function currentSettings(): Settings {
  return settingsSchema.parse({ ...persisted, toolStatus });
}

function assertSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender.id !== mainWindow.webContents.id ||
    event.senderFrame?.url !== mainWindow.webContents.getURL()
  )
    throw new Error("拒绝未知 IPC sender");
}

function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSender(event);
    return await listener(event, ...args);
  });
}

async function importPaths(raw: unknown): Promise<ProbedAsset[]> {
  if (!toolStatus.available) await checkTools();
  if (!toolStatus.available) throw new Error(`FFmpeg 工具不可用：${toolStatus.missing.join("；")}`);
  const paths = z.array(z.string().min(1)).max(100).parse(raw);
  const result: ProbedAsset[] = [];
  for (const path of paths) {
    if (resolve(path) !== path) throw new Error("只接受本地绝对路径");
    const id = randomUUID();
    const asset = await probeAsset(persisted.ffprobePath, path, id);
    assets.set(id, asset);
    mediaFiles.set(`asset/${id}`, path);
    result.push(asset);
  }
  return result;
}

function sanitizeAssets(items: ProbedAsset[]): Array<Omit<ProbedAsset, "path" | "container">> {
  return items.map((item) => ({
    id: item.id,
    fileName: item.fileName,
    durationUs: item.durationUs,
    size: item.size,
    mtimeMs: item.mtimeMs,
    previewUrl: item.previewUrl,
    video: item.video,
    audio: item.audio,
    warnings: item.warnings,
  }));
}

async function resolveExport(request: ExportRequest): Promise<{
  clips: ResolvedClip[];
  fontPath: string | null;
  output: { path: string; replaceAuthorized: boolean };
}> {
  const clips = request.clips.map((clip) => {
    const asset = assets.get(clip.assetId);
    if (!asset) throw new Error("素材引用已失效，请重新导入");
    return { asset, startUs: clip.startUs, endUs: clip.endUs };
  });
  for (const clip of clips) {
    const current = await stat(clip.asset.path);
    if (current.size !== clip.asset.size || current.mtimeMs !== clip.asset.mtimeMs)
      throw new Error(`${clip.asset.fileName} 在导入后已变更，请重新导入`);
  }
  const fontPath = request.watermark.fontId ? (fonts.get(request.watermark.fontId) ?? null) : null;
  if (fontPath) await access(fontPath, constants.R_OK);
  let output: { path: string; replaceAuthorized: boolean };
  if (request.output) {
    const selected = outputSelections.get(request.output.token);
    if (
      !selected ||
      selected.path !== request.output.displayPath ||
      selected.replaceAuthorized !== request.output.replaceAuthorized
    )
      throw new Error("输出选择已失效");
    output = selected;
  } else {
    output = {
      path: await allocateOutputPath(
        app.getPath("downloads"),
        defaultOutputName(clips[0]!.asset.fileName, clips.length),
      ),
      replaceAuthorized: false,
    };
  }
  const expectedExtension = `.${clips[0]!.asset.container}`;
  if (extname(output.path).toLowerCase() !== expectedExtension)
    throw new Error(`输出容器继承首段，文件扩展名必须为 ${expectedExtension}`);
  await assertOutputNotInput(
    output.path,
    clips.map((clip) => clip.asset.path),
  );
  return { clips, fontPath, output };
}

async function makePlan(
  request: ExportRequest,
  realRun: boolean,
): Promise<{ plan: ExecutionPlan; tempDirectory: string }> {
  const resolvedExport = await resolveExport(request);
  const outputDirectory = dirname(resolvedExport.output.path);
  if (realRun) await mkdir(outputDirectory, { recursive: true });
  const tempDirectory = realRun
    ? await mkdtemp(join(outputDirectory, ".video-quick-editor-"))
    : join(app.getPath("temp"), "video-quick-editor-plan");
  const tempOutputPath = join(tempDirectory, `output${extname(resolvedExport.output.path)}`);
  const textFilePath = request.watermark.enabled ? join(tempDirectory, "watermark.txt") : null;
  if (realRun && textFilePath) await writeFile(textFilePath, request.watermark.text, "utf8");
  const plan = createExecutionPlan({
    ffmpegPath: persisted.ffmpegPath,
    clips: resolvedExport.clips,
    request,
    fontPath: resolvedExport.fontPath,
    textFilePath,
    tempDirectory,
    tempOutputPath,
    finalOutputPath: resolvedExport.output.path,
  });
  return { plan, tempDirectory };
}

function emitJobs(): void {
  mainWindow?.webContents.send("export:jobs", structuredClone(jobs));
}
function updateJob(job: ExportJob, update: Partial<ExportJob>): void {
  Object.assign(job, update, { updatedAt: new Date().toISOString() });
  emitJobs();
}

async function createProxy(assetId: string): Promise<string> {
  const asset = assets.get(z.string().uuid().parse(assetId));
  if (!asset) throw new Error("素材引用已失效");
  const key = createHash("sha256")
    .update(`${asset.path}:${asset.size}:${asset.mtimeMs}:h264-aac-720`)
    .digest("hex");
  const directory = join(app.getPath("sessionData"), "cache", "video-quick-editor", "proxies");
  const path = join(directory, `${key}.mp4`);
  try {
    await access(path, constants.R_OK);
  } catch {
    await mkdir(directory, { recursive: true });
    await runProcess(persisted.ffmpegPath, [
      "-nostdin",
      "-y",
      "-i",
      asset.path,
      "-vf",
      "scale=-2:min(720\\,ih)",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "25",
      ...(asset.audio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
      path,
    ]);
  }
  mediaFiles.set(`proxy/${key}`, path);
  return `media://proxy/${key}`;
}

function escapeFilterPath(path: string): string {
  return path.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "'\\''");
}

async function previewFrame(raw: unknown): Promise<string> {
  const input = z
    .object({
      assetId: z.string().uuid(),
      atUs: z.number().int().nonnegative(),
      watermark: watermarkSchema,
    })
    .parse(raw);
  const asset = assets.get(input.assetId);
  if (!asset || input.atUs > asset.durationUs) throw new Error("预览位置无效");
  const directory = join(app.getPath("sessionData"), "cache", "video-quick-editor", "frames");
  await mkdir(directory, { recursive: true });
  const id = randomUUID();
  const path = join(directory, `${id}.png`);
  const args = ["-nostdin", "-y", "-ss", secondsArg(input.atUs), "-i", asset.path];
  if (input.watermark.enabled) {
    const fontPath = input.watermark.fontId ? fonts.get(input.watermark.fontId) : null;
    if (!fontPath) throw new Error("水印字体已失效");
    const textPath = join(directory, `${id}.txt`);
    await writeFile(textPath, input.watermark.text, "utf8");
    const coordinates = {
      "top-left": [`${input.watermark.margin}`, `${input.watermark.margin}`],
      "top-right": [`w-text_w-${input.watermark.margin}`, `${input.watermark.margin}`],
      "bottom-left": [`${input.watermark.margin}`, `h-text_h-${input.watermark.margin}`],
      "bottom-right": [`w-text_w-${input.watermark.margin}`, `h-text_h-${input.watermark.margin}`],
    } as const;
    const [x, y] = coordinates[input.watermark.position];
    args.push(
      "-vf",
      `drawtext=fontfile='${escapeFilterPath(fontPath)}':textfile='${escapeFilterPath(textPath)}':expansion=none:fontsize=${input.watermark.fontSize}:fontcolor=white:borderw=${Math.max(2, Math.round(input.watermark.fontSize / 16))}:bordercolor=black:x=${x}:y=${y}`,
    );
  }
  args.push("-frames:v", "1", path);
  await runProcess(persisted.ffmpegPath, args);
  mediaFiles.set(`frame/${id}`, path);
  return `media://frame/${id}`;
}

function installIpc(): void {
  handle("assets:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "视频", extensions: ["mp4", "mov", "mkv"] }],
    });
    return result.canceled ? [] : sanitizeAssets(await importPaths(result.filePaths));
  });
  handle("assets:import-paths", async (_event, raw) => sanitizeAssets(await importPaths(raw)));
  handle("font:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      filters: [{ name: "字体", extensions: ["ttf", "otf", "ttc"] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    await access(path, constants.R_OK);
    const id = randomUUID();
    fonts.set(id, path);
    persisted.defaultFontId = id;
    await saveSettings();
    return { id, name: basename(path) };
  });
  handle("settings:choose-tool", async (_event, raw) => {
    const kind = z.enum(["ffmpeg", "ffprobe"]).parse(raw);
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      title: `选择 ${kind} executable`,
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle("output:choose", async (_event, raw) => {
    const suggestedName = z.string().min(1).max(255).parse(raw);
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: join(app.getPath("downloads"), suggestedName),
      filters: [{ name: "视频", extensions: [extname(suggestedName).slice(1)] }],
    });
    if (result.canceled || !result.filePath) return null;
    let replaceAuthorized = false;
    try {
      await access(result.filePath, constants.F_OK);
      replaceAuthorized = true;
    } catch {
      /* new path */
    }
    const selection: OutputSelection = {
      token: randomUUID(),
      displayPath: result.filePath,
      replaceAuthorized,
    };
    outputSelections.set(selection.token, { path: result.filePath, replaceAuthorized });
    return selection;
  });
  handle("settings:get", () => currentSettings());
  handle("settings:update", async (_event, raw) => {
    const update = z
      .object({ ffmpegPath: z.string().optional(), ffprobePath: z.string().optional() })
      .parse(raw);
    if (update.ffmpegPath !== undefined) persisted.ffmpegPath = update.ffmpegPath;
    if (update.ffprobePath !== undefined) persisted.ffprobePath = update.ffprobePath;
    await saveSettings();
    await checkTools();
    return currentSettings();
  });
  handle("settings:check-tools", async () => await checkTools());
  handle("preview:proxy", async (_event, raw) => await createProxy(z.string().uuid().parse(raw)));
  handle("preview:frame", async (_event, raw) => await previewFrame(raw));
  handle("export:plan", async (_event, raw) => {
    const request = exportRequestSchema.parse(raw);
    const { plan } = await makePlan(request, false);
    const view: ExportPlanView = {
      mode: plan.mode,
      outputPath: plan.outputPath,
      expectedDurationUs: plan.expectedDurationUs,
      stages: plan.stages,
      changes: plan.changes,
      warnings: plan.warnings,
    };
    return view;
  });
  handle("export:start", async (_event, raw) => {
    if (jobs.some((job) => !["completed", "failed", "cancelled"].includes(job.state)))
      throw new Error("一次只能运行一个导出任务");
    const request = exportRequestSchema.parse(raw);
    const taskName = request.clips.length > 1 ? "组合" : "裁剪";
    const now = new Date().toISOString();
    const job: ExportJob = {
      id: randomUUID(),
      request: structuredClone(request),
      state: "validating",
      progress: 0,
      phase: `校验${taskName}任务`,
      resultPath: null,
      error: null,
      diagnostics: [],
      createdAt: now,
      updatedAt: now,
    };
    jobs.unshift(job);
    emitJobs();
    const controller = new AbortController();
    controllers.set(job.id, controller);
    void (async () => {
      try {
        const { plan, tempDirectory } = await makePlan(request, true);
        updateJob(job, { state: "preparing", phase: `准备${taskName}临时资源`, progress: 0 });
        const selection = request.output ? outputSelections.get(request.output.token) : null;
        await executePlan({
          ffmpegPath: persisted.ffmpegPath,
          ffprobePath: persisted.ffprobePath,
          plan,
          tempDirectory,
          replaceAuthorized: selection?.replaceAuthorized ?? false,
          signal: controller.signal,
          onPhase(phase, progress) {
            updateJob(job, {
              state: phase.includes("验证") || phase.includes("发布") ? "verifying" : "running",
              phase,
              progress,
            });
          },
        });
        updateJob(job, {
          state: "completed",
          phase: `${taskName}完成`,
          progress: 1,
          resultPath: plan.finalOutputPath,
        });
      } catch (error) {
        updateJob(
          job,
          controller.signal.aborted
            ? { state: "cancelled", phase: `${taskName}已中断`, error: null }
            : {
                state: "failed",
                phase: `${taskName}失败`,
                error: message(error),
                diagnostics: [message(error)].slice(-20),
              },
        );
      } finally {
        controllers.delete(job.id);
      }
    })();
    return structuredClone(job);
  });
  handle("export:cancel", (_event, raw) => {
    const id = z.string().uuid().parse(raw);
    const job = jobs.find((item) => item.id === id);
    const controller = controllers.get(id);
    if (!job || !controller) throw new Error("任务不存在或已经结束");
    updateJob(job, { state: "cancelling", phase: "正在中断并清理半成品" });
    controller.abort();
  });
  handle("export:delete-jobs", (_event, raw) => {
    const ids = new Set(z.array(z.string().uuid()).min(1).max(100).parse(raw));
    const selected = jobs.filter((job) => ids.has(job.id));
    if (selected.length !== ids.size) throw new Error("部分任务不存在");
    if (selected.some((job) => !terminalJobStates.has(job.state)))
      throw new Error("只能删除已完成、失败或已中断的任务记录");
    for (let index = jobs.length - 1; index >= 0; index -= 1)
      if (ids.has(jobs[index]!.id)) jobs.splice(index, 1);
    emitJobs();
  });
  handle("export:get-jobs", () => structuredClone(jobs));
  handle("output:reveal", (_event, raw) => {
    shell.showItemInFolder(completedJob(raw).resultPath!);
  });
  handle("output:open", async (_event, raw) => {
    const error = await shell.openPath(completedJob(raw).resultPath!);
    if (error) throw new Error(error);
  });
}

function completedJob(raw: unknown): ExportJob {
  const id = z.string().uuid().parse(raw);
  const job = jobs.find((item) => item.id === id);
  if (!job || job.state !== "completed" || !job.resultPath)
    throw new Error("只能操作已完成任务的真实输出");
  return job;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (allowQuit || !jobs.some((job) => !["completed", "failed", "cancelled"].includes(job.state)))
      return;
    event.preventDefault();
    void dialog
      .showMessageBox(mainWindow!, {
        type: "warning",
        buttons: ["继续留在应用", "取消任务并退出"],
        defaultId: 0,
        cancelId: 0,
        message: "导出仍在进行中",
      })
      .then(({ response }) => {
        if (response !== 1) return;
        for (const controller of controllers.values()) controller.abort();
        allowQuit = true;
        app.quit();
      });
  });
  if (process.env.VITE_DEV_SERVER_URL) await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

void app.whenReady().then(async () => {
  await loadSettings();
  await checkTools();
  protocol.handle("media", async (request) => {
    const url = new URL(request.url);
    const path = mediaFiles.get(`${url.hostname}${url.pathname}`);
    if (!path) return new Response("Not found", { status: 404 });
    return await net.fetch(pathToFileURL(path).toString(), { headers: request.headers });
  });
  installIpc();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
