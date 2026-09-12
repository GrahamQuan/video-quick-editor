import { downloadInstaller } from "./update-installer.js";
import { AppUpdates } from "./app-updates.js";
import { ExportQueue } from "./export-queue.js";
import { Dependencies, type ToolPaths } from "./dependencies.js";
import { resolveImportPaths } from "./import-paths.js";
import { findDefaultFont } from "./fonts.js";
import { EditorService } from "./editor-service.js";
import { ModelStore } from "./model.js";
import { AgentRunner } from "./agent.js";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, stat, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { mediaResponse } from "./media-response.js";
import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import {
  validateWatermarkFont,
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
  modelUpdateSchema,
  modelProfilesSchema,
  saveModelProfileSchema,
  modelProfileMutationSchema,
  testModelProfileSchema,
  modelTestResultSchema,
  agentReservationSchema,
  exportRequestSchema,
  timestampOutputName,
  settingsSchema,
  watermarkSchema,
  type ExportJob,
  type ExportPlanView,
  type ExportRequest,
  type Language,
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
const sourceIdentities = new Map<string, { dev: number; ino: number }>();
const fonts = new Map<string, string>();
const outputSelections = new Map<string, { path: string; replaceAuthorized: boolean }>();
const mediaFiles = new Map<string, string>();

const terminalJobStates = new Set<ExportJob["state"]>(["completed", "failed", "cancelled"]);
let mainWindow: BrowserWindow | null = null;
let allowQuit = false;
let quitPromptOpen = false;

interface PersistedSettings {
  ffmpegPath: string;
  ffprobePath: string;
  defaultFontId: string | null;
  language: Language;
  fonts: Record<string, string>;
}
let persisted: PersistedSettings = {
  ffmpegPath: "",
  ffprobePath: "",
  defaultFontId: null,
  language: "en",
  fonts: {},
};
const dependencies = new Dependencies((state) =>
  mainWindow?.webContents.send("dependencies:state", state),
);

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
        language: z.enum(["en", "zh-CN"]).default("en"),
        fonts: z.record(z.string(), z.string()),
      })
      .parse(JSON.parse(await readFile(settingsPath(), "utf8")) as unknown);
    persisted = value;
    for (const [id, path] of Object.entries(value.fonts)) fonts.set(id, path);
  } catch {
    /* first run or invalid settings */
  }
  const selectedPath = persisted.defaultFontId
    ? (fonts.get(persisted.defaultFontId) ?? null)
    : null;
  const defaultPath = await findDefaultFont(selectedPath);
  if (defaultPath !== selectedPath || (!defaultPath && persisted.defaultFontId)) {
    persisted.defaultFontId = defaultPath ? randomUUID() : null;
    if (defaultPath && persisted.defaultFontId) fonts.set(persisted.defaultFontId, defaultPath);
    await saveSettings();
  }
  editor.update(editor.snapshot().revision, {
    ...editor.snapshot().request,
    watermark: { ...editor.snapshot().request.watermark, fontId: persisted.defaultFontId },
  });
  dependencies.configure({ ffmpegPath: persisted.ffmpegPath, ffprobePath: persisted.ffprobePath });
}

async function saveSettings(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  persisted.fonts = Object.fromEntries(fonts);
  await writeFile(settingsPath(), JSON.stringify(persisted, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function checkTools(): Promise<Settings["toolStatus"]> {
  await dependencies.check();
  return dependencies.legacy();
}

function currentSettings(): Settings {
  return settingsSchema.parse({
    ...persisted,
    toolStatus: dependencies.legacy(),
    defaultFontName:
      persisted.defaultFontId && fonts.get(persisted.defaultFontId)
        ? basename(fonts.get(persisted.defaultFontId)!)
        : null,
  });
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
  const tools = await dependencies.requireReady();
  const paths = await resolveImportPaths(raw);
  const result: ProbedAsset[] = [];
  for (const path of paths) {
    if (resolve(path) !== path) throw new Error("只接受本地绝对路径");
    const id = randomUUID();
    const asset = await probeAsset(tools.ffprobePath, path, id);
    result.push(asset);
  }
  for (const asset of result) {
    const identity = await stat(asset.path);
    sourceIdentities.set(asset.id, { dev: identity.dev, ino: identity.ino });
    assets.set(asset.id, asset);
    mediaFiles.set(`asset/${asset.id}`, asset.path);
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

async function resolveExport(
  request: ExportRequest,
  reservedOutput?: string,
): Promise<{
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
    const identity = sourceIdentities.get(clip.asset.id);
    if (
      current.size !== clip.asset.size ||
      current.mtimeMs !== clip.asset.mtimeMs ||
      current.dev !== identity?.dev ||
      current.ino !== identity?.ino
    )
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
      path:
        reservedOutput ??
        (await allocateOutputPath(
          app.getPath("downloads"),
          defaultOutputName(clips[0]!.asset.fileName, clips.length, request.outputProfile),
        )),
      replaceAuthorized: false,
    };
  }

  for (const clip of request.clips) {
    const watermark = clip.watermark ?? request.watermark;
    if (!watermark.enabled) continue;
    watermarkSchema.parse(watermark);
    const selectedFont = watermark.fontId ? fonts.get(watermark.fontId) : null;
    if (!selectedFont) throw new Error("启用水印时必须选择可读字体");
    await access(selectedFont, constants.R_OK);
    const first = clips[0]!.asset.video;
    validateWatermarkFont(
      watermark,
      selectedFont,
      request.mode === "normalize"
        ? (request.normalize.width ?? first.displayWidth)
        : first.displayWidth,
      request.mode === "normalize"
        ? (request.normalize.height ?? first.displayHeight)
        : first.displayHeight,
    );
  }
  let writableParent = dirname(output.path);
  for (;;) {
    try {
      await access(writableParent, constants.W_OK);
      break;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        dirname(writableParent) === writableParent
      )
        throw error;
      writableParent = dirname(writableParent);
    }
  }
  const expectedExtension =
    request.outputProfile === "mp4-compatible" ? ".mp4" : `.${clips[0]!.asset.container}`;
  if (extname(output.path).toLowerCase() !== expectedExtension)
    throw new Error(`输出容器继承首段，文件扩展名必须为 ${expectedExtension}`);
  await assertOutputNotInput(
    output.path,
    [...assets.values()].map((asset) => asset.path),
  );
  return { clips, fontPath, output };
}

async function makePlan(
  request: ExportRequest,
  realRun: boolean,
  reservedOutput?: string,
): Promise<{ plan: ExecutionPlan; tempDirectory: string; tools: ToolPaths }> {
  request = {
    ...request,
    mode: request.modeWasManuallySelected
      ? request.mode
      : request.clips.length === 1
        ? "accurate"
        : "normalize",
  };
  const tools = await dependencies.requireReady();
  const resolvedExport = await resolveExport(request, reservedOutput);
  const outputDirectory = dirname(resolvedExport.output.path);
  if (realRun) await mkdir(outputDirectory, { recursive: true });
  const tempDirectory = realRun
    ? await mkdtemp(join(outputDirectory, ".video-quick-editor-"))
    : join(app.getPath("temp"), "video-quick-editor-plan");
  const tempOutputPath = join(tempDirectory, `output${extname(resolvedExport.output.path)}`);
  try {
    const textFilePath = request.watermark.enabled ? join(tempDirectory, "watermark.txt") : null;
    if (realRun && textFilePath) await writeFile(textFilePath, request.watermark.text, "utf8");
    const watermarkResources = await Promise.all(
      request.clips.map(async (clip, index) => {
        const watermark = clip.watermark ?? request.watermark;
        const path = watermark.enabled ? join(tempDirectory, `watermark-${index}.txt`) : null;
        if (realRun && path) await writeFile(path, watermark.text, "utf8");
        return {
          fontPath: watermark.fontId ? (fonts.get(watermark.fontId) ?? null) : null,
          textFilePath: path,
        };
      }),
    );
    const plan = createExecutionPlan({
      watermarkResources,
      ffmpegPath: tools.ffmpegPath,
      clips: resolvedExport.clips,
      request,
      fontPath: resolvedExport.fontPath,
      textFilePath,
      tempDirectory,
      tempOutputPath,
      finalOutputPath: resolvedExport.output.path,
    });
    return { plan, tempDirectory, tools };
  } catch (error) {
    if (realRun) await rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}

function emitJobs(): void {
  mainWindow?.webContents.send("export:jobs", structuredClone(jobs));
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
    const tools = await dependencies.requireReady();
    await mkdir(directory, { recursive: true });
    await runProcess(tools.ffmpegPath, [
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
  const tools = await dependencies.requireReady();
  const draft = editor.snapshot().request;
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

  const firstId =
    editor.draft.operation === "combine"
      ? editor.draft.combineClipIds[0]
      : editor.draft.selectedClipId;
  const firstClip = draft.clips.find((c) => c.id === firstId);
  const first = firstClip ? assets.get(firstClip.assetId) : asset;
  const outputWidth =
    draft.mode === "normalize"
      ? (draft.normalize.width ?? first?.video.displayWidth ?? asset.video.displayWidth)
      : asset.video.displayWidth;
  const outputHeight =
    draft.mode === "normalize"
      ? (draft.normalize.height ?? first?.video.displayHeight ?? asset.video.displayHeight)
      : asset.video.displayHeight;
  const width = outputWidth + (outputWidth % 2),
    height = outputHeight + (outputHeight % 2);
  const baseFilter =
    draft.mode === "normalize"
      ? `scale=trunc(iw*sar+0.5):ih,setsar=1,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`
      : draft.outputProfile === "mp4-compatible"
        ? "scale=trunc(iw*sar+0.5):ih,setsar=1,pad=ceil(iw/2)*2:ceil(ih/2)*2"
        : "null";
  if (input.watermark.enabled) {
    const fontPath = input.watermark.fontId ? fonts.get(input.watermark.fontId) : null;
    if (!fontPath) throw new Error("水印字体已失效");
    validateWatermarkFont(input.watermark, fontPath, width, height);
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
      `${baseFilter},drawtext=fontfile='${escapeFilterPath(fontPath)}':textfile='${escapeFilterPath(textPath)}':expansion=none:fontsize=${input.watermark.fontSize}:fontcolor=white:borderw=${input.watermark.borderWidth}:bordercolor=black:x=${x}:y=${y}`,
    );
  }
  if (!input.watermark.enabled) args.push("-vf", baseFilter);
  args.push("-frames:v", "1", path);
  await runProcess(tools.ffmpegPath, args);
  mediaFiles.set(`frame/${id}`, path);
  return `media://frame/${id}`;
}

const reservedPaths = new Set<string>();
const consumedOutputTokens = new Set<string>();
async function canonicalOutputParent(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return join(await canonicalOutputParent(dirname(path)), basename(path));
  }
}
async function outputIdentity(path: string): Promise<string> {
  try {
    const info = await stat(path);
    return `inode:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonicalOutputParent(dirname(path)), basename(path))
      .normalize("NFC")
      .toLowerCase();
  }
}
const reservedIdentities = new Set<string>();
const exportQueue = new ExportQueue<{ request: ExportRequest; path: string; identity: string }>({
  async accept(request, date) {
    await dependencies.requireReady();
    let path: string;
    if (request.output) {
      path = request.output.displayPath;
      if (consumedOutputTokens.has(request.output.token))
        throw new Error("OUTPUT_CONFLICT: Output authorization already used");
    } else {
      const asset = assets.get(request.clips[0]!.assetId);
      if (!asset) throw new Error("ASSET_NOT_FOUND");
      const name = timestampOutputName(asset.fileName, request.outputProfile, date);
      path = await allocateOutputPath(app.getPath("downloads"), name, reservedPaths);
    }
    const identity = await outputIdentity(path);
    if (reservedIdentities.has(identity) || reservedPaths.has(path))
      throw new Error("OUTPUT_CONFLICT: Output already assigned");
    await makePlan(request, false, path);
    if (request.output && !request.output.replaceAuthorized) {
      try {
        await stat(path);
        throw new Error("OUTPUT_CONFLICT: Output exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    reservedPaths.add(path);
    reservedIdentities.add(identity);
    if (request.output) consumedOutputTokens.add(request.output.token);
    return {
      snapshot: { request, path, identity },
      outputName: basename(path),
      clipNames: request.clips.map((c) => assets.get(c.assetId)!.fileName),
    };
  },
  async execute({ request, path, identity }, signal, update) {
    signal.throwIfAborted();
    if (!request.output)
      path = await allocateOutputPath(
        dirname(path),
        basename(path),
        new Set([...reservedPaths].filter((p) => p !== path)),
      );
    reservedPaths.add(path);
    const { plan, tempDirectory, tools } = await makePlan(request, true, path);
    try {
      signal.throwIfAborted();
      update({ state: "preparing", phase: "准备临时资源", progress: null });
      await executePlan({
        ffmpegPath: tools.ffmpegPath,
        ffprobePath: tools.ffprobePath,
        plan,
        tempDirectory,
        replaceAuthorized: request.output?.replaceAuthorized ?? false,
        signal,
        async beforePublish() {
          await assertOutputNotInput(
            plan.finalOutputPath,
            [...assets.values()].map((asset) => asset.path),
          );
          if (request.output && (await outputIdentity(plan.finalOutputPath)) !== identity)
            throw new Error("OUTPUT_CONFLICT: Authorized target changed");
        },
        ...(!request.output
          ? {
              resolveOutputConflict: async () => {
                const next = await allocateOutputPath(dirname(path), basename(path), reservedPaths);
                reservedPaths.add(next);
                return next;
              },
            }
          : {}),
        onPhase(phase, progress) {
          update({
            state: phase.includes("验证") || phase.includes("发布") ? "verifying" : "running",
            phase,
            progress,
          });
        },
      });
      return plan.finalOutputPath;
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  },
  finish({ request, path, identity }, job) {
    reservedPaths.delete(path);
    reservedIdentities.delete(identity);
    if ((job.state === "failed" || job.state === "cancelled") && request.output)
      consumedOutputTokens.delete(request.output.token);
  },
  emit: emitJobs,
});
const jobs = exportQueue.jobs;
function startExport(raw: unknown): Promise<ExportJob> {
  return exportQueue.start(raw);
}
function cancelExport(id: string): void {
  exportQueue.cancel(id);
}
let models: ModelStore;
let agent: AgentRunner;
const editor = new EditorService({
  assets: () => sanitizeAssets([...assets.values()]),
  fontAvailable: (id) => !!id && fonts.has(id),
  output: (token) => {
    const item = outputSelections.get(token);
    return item
      ? { token, displayPath: item.path, replaceAuthorized: item.replaceAuthorized }
      : null;
  },
  plan: async (request) => (await makePlan(request, false)).plan,
  start: startExport,
  jobs: () => structuredClone(jobs),
  cancel: cancelExport,
  preview: previewFrame,
  emit: (draft) => mainWindow?.webContents.send("editor:draft", draft),
});

function installIpc(): void {
  handle("app:update-menu-ready", () => {
    updateMenuReady = true;
    deliverUpdateMenu();
  });
  const updates = new AppUpdates(
    app.getVersion(),
    (state) => mainWindow?.webContents.send("app:update-state", state),
    (...args) => fetch(...args),
    (version, progress) =>
      downloadInstaller(
        version,
        join(app.getPath("userData"), "video-quick-editor-updates"),
        progress,
        (path) => shell.openPath(path),
        (...args) => fetch(...args),
      ),
  );
  handle("app:update-download", () => updates.download());
  handle("app:update-get", () => updates.snapshot());
  handle("app:update-check", (_event, raw) => updates.check(z.boolean().parse(raw)));
  handle("app:update-open", () => updates.open((url) => shell.openExternal(url)));
  handle("editor:get", () => editor.snapshot());
  handle("editor:update", (_event, raw) => {
    const i = z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        request: z.unknown(),
        selectedClipId: z.string().uuid().nullable(),
        operation: z.enum(["trim", "combine"]).optional(),
        combineClipIds: z.array(z.string().uuid()).optional(),
        combineInitialized: z.boolean().optional(),
        combineOrderCustomized: z.boolean().optional(),
      })
      .parse(raw);
    return editor.update(i.expectedRevision, i.request, i.selectedClipId, i);
  });
  handle("model:profiles", () => modelProfilesSchema.parse(models.list()));
  handle("model:save-profile", async (_event, raw) =>
    modelProfilesSchema.parse(await models.saveProfile(saveModelProfileSchema.parse(raw))),
  );
  handle("model:delete-profile", async (_event, raw) => {
    const input = modelProfileMutationSchema.parse(raw);
    return modelProfilesSchema.parse(await models.deleteProfile(input.id, input.expectedRevision));
  });
  handle("model:select-profile", async (_event, raw) => {
    const input = modelProfileMutationSchema.parse(raw);
    return modelProfilesSchema.parse(await models.selectProfile(input.id, input.expectedRevision));
  });
  handle("model:test-profile", async (_event, raw) =>
    modelTestResultSchema.parse(await models.testProfile(testModelProfileSchema.parse(raw))),
  );
  handle("agent:reserve", () => agentReservationSchema.parse(agent.reserve()));
  handle("agent:release", (_event, raw) => agent.release(z.string().uuid().parse(raw)));
  handle("model:get", () => models.view());
  handle("model:save", async (_event, raw) => await models.save(modelUpdateSchema.parse(raw)));
  handle("model:test", async (_event, raw) => await models.test(modelUpdateSchema.parse(raw)));
  handle("agent:get", () => agent.snapshot());
  handle(
    "agent:send",
    async (_event, raw, displayText, reservationToken) =>
      await agent.send(
        z.string().parse(raw),
        z.string().max(8000).optional().parse(displayText),
        z.string().uuid().optional().parse(reservationToken),
      ),
  );
  handle("agent:stop", () => agent.stop());
  handle("agent:clear", async () => await agent.clear());
  handle("dependencies:get", () => dependencies.snapshot());
  handle("assets:choose", async () => {
    await dependencies.requireReady();
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
      .object({
        ffmpegPath: z.string().optional(),
        ffprobePath: z.string().optional(),
        language: z.enum(["en", "zh-CN"]).optional(),
      })
      .parse(raw);
    const toolPathChanged = update.ffmpegPath !== undefined || update.ffprobePath !== undefined;
    if (update.ffmpegPath !== undefined) persisted.ffmpegPath = update.ffmpegPath;
    if (update.ffprobePath !== undefined) persisted.ffprobePath = update.ffprobePath;
    if (update.language !== undefined) {
      persisted.language = update.language;
      installApplicationMenu();
    }
    await saveSettings();
    if (toolPathChanged) {
      dependencies.configure({
        ffmpegPath: persisted.ffmpegPath,
        ffprobePath: persisted.ffprobePath,
      });
      await checkTools();
    }
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
  handle("assets:get", () => sanitizeAssets([...assets.values()]));
  handle("export:retry", async (_event, raw) => {
    const { jobId, requestId } = z
      .object({ jobId: z.string().uuid(), requestId: z.string().min(1).max(128) })
      .parse(raw);
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.state !== "failed") throw new Error("Only failed jobs can be requeued");
    return startExport({ ...structuredClone(job.request), requestId });
  });
  handle("export:start", async (_event, raw) => await startExport(raw));
  handle("export:cancel", (_event, raw) => cancelExport(z.string().uuid().parse(raw)));
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

let updateMenuReady = false;
let updateMenuPending = false;
function deliverUpdateMenu(): void {
  if (!updateMenuReady || !updateMenuPending || !mainWindow || mainWindow.isDestroyed()) return;
  updateMenuPending = false;
  mainWindow.webContents.send("app:update-menu");
}
function installApplicationMenu(): void {
  const zh = persisted.language === "zh-CN";
  const name = "Video Quick Editor";
  app.setAboutPanelOptions({ applicationName: name, applicationVersion: app.getVersion() });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: name,
        submenu: [
          { role: "about", label: zh ? `关于 ${name}` : `About ${name}` },
          {
            id: "check-for-updates",
            label: zh ? "检查更新…" : "Check for Updates…",
            click: () => {
              updateMenuPending = true;
              if (!mainWindow || mainWindow.isDestroyed()) {
                void createWindow();
              } else {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
                deliverUpdateMenu();
              }
            },
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide", label: zh ? `隐藏 ${name}` : `Hide ${name}` },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit", label: zh ? `退出 ${name}` : `Quit ${name}` },
        ],
      },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      { role: "help", submenu: [] },
    ]),
  );
}

async function createWindow(): Promise<void> {
  updateMenuReady = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
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
  mainWindow.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) updateMenuReady = false;
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (allowQuit || !exportQueue.hasUnfinished) return;
    event.preventDefault();
    if (quitPromptOpen) return;
    quitPromptOpen = true;
    void dialog
      .showMessageBox(mainWindow!, {
        type: "warning",
        buttons:
          persisted.language === "zh-CN"
            ? ["继续留在应用", "取消全部任务并退出"]
            : ["Stay in app", "Cancel all jobs and quit"],
        defaultId: 0,
        cancelId: 0,
        message:
          persisted.language === "zh-CN"
            ? "仍有活动或等待中的导出任务"
            : "Exports are running or waiting",
      })
      .then(async ({ response }) => {
        if (response !== 1) {
          quitPromptOpen = false;
          return;
        }
        await exportQueue.close();
        allowQuit = true;
        app.quit();
      });
  });
  if (process.env.VITE_DEV_SERVER_URL) await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

void app.whenReady().then(async () => {
  await loadSettings();
  models = new ModelStore(app.getPath("userData"), (view) =>
    mainWindow?.webContents.send("model:profiles", view),
  );
  await models.load();
  agent = new AgentRunner(editor, models, (session) =>
    mainWindow?.webContents.send("agent:session", session),
  );
  protocol.handle("media", async (request) => {
    const url = new URL(request.url);
    const path = mediaFiles.get(`${url.hostname}${url.pathname}`);
    if (!path) return new Response("Not found", { status: 404 });
    return await mediaResponse(request, path);
  });
  installIpc();
  installApplicationMenu();
  await createWindow();
  void checkTools();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
