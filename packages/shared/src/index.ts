import { z } from "zod";

const safeUs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const positionSchema = z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]);
export const exportModeSchema = z.enum(["accurate", "normalize", "copy"]);
export const languageSchema = z.enum(["en", "zh-CN"]);
export const jobStateSchema = z.enum([
  "validating",
  "preparing",
  "running",
  "verifying",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
]);

export const rationalSchema = z.object({
  numerator: z.number().int(),
  denominator: z.number().int().positive(),
});
export const videoInfoSchema = z.object({
  codec: z.string(),
  profile: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  displayWidth: z.number().int().positive(),
  displayHeight: z.number().int().positive(),
  pixelFormat: z.string(),
  timeBase: z.string(),
  frameRate: rationalSchema.nullable(),
  variableFrameRate: z.boolean(),
  bitDepth: z.number().int().nullable(),
  colorTransfer: z.string().nullable(),
  rotation: z.number().int(),
});
export const audioInfoSchema = z.object({
  codec: z.string(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
  channelLayout: z.string().nullable(),
});
export const assetViewSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().min(1),
  durationUs: safeUs.positive(),
  size: safeUs,
  mtimeMs: z.number().nonnegative(),
  previewUrl: z.string(),
  video: videoInfoSchema,
  audio: audioInfoSchema.nullable(),
  warnings: z.array(z.string()),
});
export const watermarkSchema = z
  .object({
    enabled: z.boolean(),
    text: z.string().max(500),
    fontId: z.string().uuid().nullable(),
    position: positionSchema,
    fontSize: z.number().int().min(8).max(512),
    borderWidth: z.number().int().min(0).max(20).default(1),
    margin: z.number().int().min(0).max(4096),
  })
  .superRefine((watermark, context) => {
    if (!watermark.enabled) return;
    if (!watermark.text.trim())
      context.addIssue({ code: "custom", message: "启用水印时文案不能为空", path: ["text"] });
    if (/\r|\n|\0/u.test(watermark.text))
      context.addIssue({ code: "custom", message: "水印不支持换行或 NUL", path: ["text"] });
    if (!watermark.fontId)
      context.addIssue({ code: "custom", message: "启用水印时必须选择字体", path: ["fontId"] });
  });
export const clipSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    startUs: safeUs,
    endUs: safeUs.positive(),
    watermark: z.object(watermarkSchema.shape).optional(),
  })
  .refine((clip) => clip.startUs < clip.endUs, { message: "片段起点必须早于终点" });
export const outputSelectionSchema = z.object({
  token: z.string().uuid(),
  displayPath: z.string(),
  replaceAuthorized: z.boolean(),
});
export const exportRequestSchema = z.object({
  outputProfile: z.enum(["mp4-compatible", "source"]).default("source"),
  clips: z
    .array(clipSchema)
    .min(1)
    .superRefine((clips, ctx) => {
      clips.forEach((clip, index) => {
        if (!clip.watermark) return;
        const result = watermarkSchema.safeParse(clip.watermark);
        if (!result.success)
          for (const issue of result.error.issues)
            ctx.addIssue({ ...issue, path: [index, "watermark", ...issue.path] });
      });
    }),
  mode: exportModeSchema,
  modeWasManuallySelected: z.boolean(),
  watermark: watermarkSchema,
  output: outputSelectionSchema.nullable(),
  videoCodec: z.enum(["h264", "hevc"]).nullable(),
  normalize: z.object({
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    fps: z.string().nullable(),
  }),
});
export const dependencyFailureSchema = z.enum([
  "not-found",
  "not-executable",
  "start-failed",
  "timeout",
  "missing-encoders",
  "missing-filters",
]);
export const dependencyToolSchema = z.object({
  tool: z.enum(["ffmpeg", "ffprobe"]),
  version: z.string().nullable(),
  failures: z.array(dependencyFailureSchema),
  missingEncoders: z.array(z.string()),
  missingFilters: z.array(z.string()),
});
export const dependencyStateSchema = z.object({
  status: z.enum(["checking", "ready", "unavailable"]),
  generation: z.number().int().nonnegative(),
  tools: z.array(dependencyToolSchema),
});
export type DependencyState = z.infer<typeof dependencyStateSchema>;
export const toolStatusSchema = z.object({
  available: z.boolean(),
  ffmpegVersion: z.string().nullable(),
  ffprobeVersion: z.string().nullable(),
  missing: z.array(z.string()),
});
export const settingsSchema = z.object({
  ffmpegPath: z.string(),
  ffprobePath: z.string(),
  defaultFontId: z.string().uuid().nullable(),
  defaultFontName: z.string().nullable().default(null),
  language: languageSchema.default("en"),
  toolStatus: toolStatusSchema,
});
export const exportPlanViewSchema = z.object({
  mode: exportModeSchema,
  outputPath: z.string(),
  expectedDurationUs: safeUs,
  stages: z.array(z.string()),
  changes: z.array(z.string()),
  warnings: z.array(z.string()),
});
export const exportJobSchema = z.object({
  id: z.string().uuid(),
  request: exportRequestSchema,
  state: jobStateSchema,
  progress: z.number().min(0).max(1).nullable(),
  phase: z.string(),
  resultPath: z.string().nullable(),
  error: z.string().nullable(),
  diagnostics: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AssetView = z.infer<typeof assetViewSchema>;
export type VideoInfo = z.infer<typeof videoInfoSchema>;
export type AudioInfo = z.infer<typeof audioInfoSchema>;
export type ClipSpec = z.infer<typeof clipSchema>;
export type WatermarkSpec = z.infer<typeof watermarkSchema>;
export type ExportRequest = z.input<typeof exportRequestSchema>;
export type ExportPlanView = z.infer<typeof exportPlanViewSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Language = z.infer<typeof languageSchema>;
export type OutputSelection = z.infer<typeof outputSelectionSchema>;

export const appUpdateSchema = z.object({
  currentVersion: z.string(),
  includePrereleases: z.boolean(),
  status: z.enum(["idle", "checking", "available", "current", "error"]),
  latestVersion: z.string().nullable(),
  checkedAt: z.string().nullable(),
  error: z.enum(["network", "rate-limit", "invalid-response"]).nullable(),
});
export type AppUpdate = z.infer<typeof appUpdateSchema>;
export interface VideoQuickEditorApi extends AgentApi {
  getAppUpdate(): Promise<AppUpdate>;
  checkAppUpdate(includePrereleases: boolean): Promise<AppUpdate>;
  openAppUpdate(): Promise<void>;
  subscribeAppUpdate(listener: (state: AppUpdate) => void): () => void;
  getDependencies(): Promise<DependencyState>;
  subscribeDependencies(listener: (state: DependencyState) => void): () => void;
  chooseAssets(): Promise<AssetView[]>;
  importLocalPaths(paths: string[]): Promise<AssetView[]>;
  importDroppedFiles(files: File[]): Promise<AssetView[]>;
  chooseFont(): Promise<{ id: string; name: string } | null>;
  chooseTool(kind: "ffmpeg" | "ffprobe"): Promise<string | null>;
  chooseOutput(suggestedName: string): Promise<OutputSelection | null>;
  getSettings(): Promise<Settings>;
  updateSettings(update: {
    ffmpegPath?: string;
    ffprobePath?: string;
    language?: Language;
  }): Promise<Settings>;
  checkTools(): Promise<Settings["toolStatus"]>;
  createProxy(assetId: string): Promise<string>;
  previewFrame(input: { assetId: string; atUs: number; watermark: WatermarkSpec }): Promise<string>;
  planExport(request: ExportRequest): Promise<ExportPlanView>;
  startExport(request: ExportRequest): Promise<ExportJob>;
  cancelExport(jobId: string): Promise<void>;
  deleteJobs(jobIds: string[]): Promise<void>;
  getJobs(): Promise<ExportJob[]>;
  subscribeJobs(listener: (jobs: ExportJob[]) => void): () => void;
  revealOutput(jobId: string): Promise<void>;
  openOutput(jobId: string): Promise<void>;
}

export const draftRequestSchema = exportRequestSchema.extend({
  clips: z.array(clipSchema).max(100),
  watermark: z.object(watermarkSchema.shape),
});
export const editorDraftSchema = z.object({
  revision: z.number().int().nonnegative(),
  selectedClipId: z.string().uuid().nullable(),
  request: draftRequestSchema,
});
export type EditorDraft = z.infer<typeof editorDraftSchema>;
export const agentErrorCodeSchema = z.enum([
  "INVALID_ARGUMENT",
  "ASSET_NOT_FOUND",
  "STALE_REVISION",
  "PLAN_EXPIRED",
  "UNSUPPORTED_MEDIA",
  "FONT_REQUIRED",
  "OUTPUT_CONFLICT",
  "TOOLS_UNAVAILABLE",
  "EXPORT_FAILED",
]);
export const toolResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: agentErrorCodeSchema,
      message: z.string(),
      details: z.unknown().optional(),
      retryable: z.boolean(),
    }),
  }),
]);
export type ToolResult = z.infer<typeof toolResultSchema>;
const revision = z.number().int().nonnegative();
export const agentToolSchemas = {
  get_editor_context: z.object({}).strict(),
  set_timeline: z
    .object({ expectedRevision: revision, clips: z.array(clipSchema).max(100) })
    .strict(),
  set_watermark: z
    .object({ expectedRevision: revision, watermark: z.object(watermarkSchema.shape) })
    .strict(),
  set_output: z
    .object({
      expectedRevision: revision,
      outputProfile: z.enum(["source", "mp4-compatible"]),
      mode: z.enum(["accurate", "normalize", "copy"]).optional(),
      videoCodec: z.enum(["h264", "hevc"]).nullable().optional(),
      normalize: exportRequestSchema.shape.normalize.optional(),
      outputToken: z.string().uuid().nullable().optional(),
    })
    .strict(),
  preview_frame: z
    .object({ revision, clipId: z.string().uuid(), atUs: z.number().int().nonnegative() })
    .strict(),
  plan_export: z.object({ revision, clipIds: z.array(z.string().uuid()).min(1).max(100) }).strict(),
  start_export: z
    .object({ planId: z.string().uuid(), requestId: z.string().min(1).max(128) })
    .strict(),
  get_export_jobs: z.object({ jobIds: z.array(z.string().uuid()).optional() }).strict(),
  cancel_export: z.object({ jobId: z.string().uuid() }).strict(),
};
export type AgentToolName = keyof typeof agentToolSchemas;
export const editorContextSchema = z.object({
  draft: editorDraftSchema,
  assets: z.array(assetViewSchema.omit({ previewUrl: true })),
  fontAvailable: z.boolean(),
});
export const modelConfigSchema = z.object({
  provider: z.literal("openai-compatible").default("openai-compatible"),
  baseURL: z.string().min(1),
  modelId: z.string().trim().min(1).max(200),
  contextBudget: z.number().int().min(8192).max(262144).default(16384),
});
export const modelUpdateSchema = modelConfigSchema.extend({
  apiKey: z.string().max(4096).optional(),
  deleteKey: z.boolean().optional(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ModelUpdate = z.input<typeof modelUpdateSchema>;
export type ModelView = ModelConfig & { hasApiKey: boolean };
export const modelProfileSchema = modelConfigSchema.extend({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  hasApiKey: z.boolean(),
});
export const modelProfilesSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  profiles: z.array(modelProfileSchema).max(50),
  selectedProfileId: z.string().uuid().nullable(),
  error: z.string().nullable().default(null),
});
export const saveModelProfileSchema = modelUpdateSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
});
export const modelProfileMutationSchema = z
  .object({ expectedRevision: z.number().int().nonnegative(), id: z.string().uuid() })
  .strict();
export const testModelProfileSchema = modelUpdateSchema.extend({
  id: z.string().uuid().optional(),
});
export const modelTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export const modelIdentitySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  modelId: z.string(),
});
export const agentReservationSchema = z.object({
  token: z.string().uuid(),
  profile: modelIdentitySchema,
});
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelProfiles = z.infer<typeof modelProfilesSchema>;
export type SaveModelProfile = z.input<typeof saveModelProfileSchema>;
export type ModelIdentity = z.infer<typeof modelIdentitySchema>;
export type AgentReservation = z.infer<typeof agentReservationSchema>;
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  previewUrl?: string;
  model?: ModelIdentity;
  toolName?: AgentToolName;
  toolOk?: boolean;
}
export interface AgentSession {
  messages: ChatMessage[];
  running: boolean;
  model?: ModelIdentity;
}
export interface AgentApi {
  getDraft(): Promise<EditorDraft>;
  updateDraft(input: {
    expectedRevision: number;
    request: EditorDraft["request"];
    selectedClipId: string | null;
  }): Promise<EditorDraft>;
  subscribeDraft(listener: (draft: EditorDraft) => void): () => void;
  listModelProfiles(): Promise<ModelProfiles>;
  saveModelProfile(input: SaveModelProfile): Promise<ModelProfiles>;
  deleteModelProfile(input: z.infer<typeof modelProfileMutationSchema>): Promise<ModelProfiles>;
  selectModelProfile(input: z.infer<typeof modelProfileMutationSchema>): Promise<ModelProfiles>;
  testModelProfile(
    input: z.input<typeof testModelProfileSchema>,
  ): Promise<z.infer<typeof modelTestResultSchema>>;
  subscribeModelProfiles(listener: (profiles: ModelProfiles) => void): () => void;
  beginAgentTurn(): Promise<AgentReservation>;
  releaseAgentTurn(token: string): Promise<void>;
  getModel(): Promise<ModelView | null>;
  saveModel(input: ModelUpdate): Promise<ModelView>;
  testModel(input: ModelUpdate): Promise<{ ok: boolean; message: string }>;
  getAgentSession(): Promise<AgentSession>;
  sendAgent(text: string, displayText?: string, reservationToken?: string): Promise<void>;
  stopAgent(): Promise<void>;
  clearAgent(): Promise<void>;
  subscribeAgent(listener: (session: AgentSession) => void): () => void;
}

/** Local wall-clock time, with filesystem-safe separators for export names. */
export function timestampOutputName(
  fileName: string,
  outputProfile = "source",
  date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${String(date.getFullYear()).padStart(4, "0")}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}--${pad(date.getHours())}_${pad(date.getMinutes())}_${pad(date.getSeconds())}`;
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  const extension = outputProfile === "mp4-compatible" ? ".mp4" : dot > 0 ? base.slice(dot) : "";
  return `${timestamp}${extension}`;
}

/** A path-only message is handled locally, before any model request. One path per line. */
export function parseImportPathText(text: string): string[] | null {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const value = line.trim();
      return (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
    })
    .filter(Boolean);
  return lines.length &&
    lines.every((line) => line.startsWith("/") || line.startsWith("~/") || line.startsWith("file:"))
    ? lines
    : null;
}
