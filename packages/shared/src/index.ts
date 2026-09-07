import { z } from "zod";

const safeUs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const positionSchema = z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]);
export const exportModeSchema = z.enum(["accurate", "normalize", "copy"]);
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
export const clipSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    startUs: safeUs,
    endUs: safeUs.positive(),
  })
  .refine((clip) => clip.startUs < clip.endUs, { message: "片段起点必须早于终点" });
export const watermarkSchema = z
  .object({
    enabled: z.boolean(),
    text: z.string().max(500),
    fontId: z.string().uuid().nullable(),
    position: positionSchema,
    fontSize: z.number().int().min(8).max(512),
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
export const outputSelectionSchema = z.object({
  token: z.string().uuid(),
  displayPath: z.string(),
  replaceAuthorized: z.boolean(),
});
export const exportRequestSchema = z.object({
  clips: z.array(clipSchema).min(1),
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
export const settingsSchema = z.object({
  ffmpegPath: z.string(),
  ffprobePath: z.string(),
  defaultFontId: z.string().uuid().nullable(),
  toolStatus: z.object({
    available: z.boolean(),
    ffmpegVersion: z.string().nullable(),
    ffprobeVersion: z.string().nullable(),
    missing: z.array(z.string()),
  }),
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
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportPlanView = z.infer<typeof exportPlanViewSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type OutputSelection = z.infer<typeof outputSelectionSchema>;

export interface VideoQuickEditorApi {
  chooseAssets(): Promise<AssetView[]>;
  importDroppedFiles(files: File[]): Promise<AssetView[]>;
  chooseFont(): Promise<{ id: string; name: string } | null>;
  chooseTool(kind: "ffmpeg" | "ffprobe"): Promise<string | null>;
  chooseOutput(suggestedName: string): Promise<OutputSelection | null>;
  getSettings(): Promise<Settings>;
  updateSettings(update: { ffmpegPath?: string; ffprobePath?: string }): Promise<Settings>;
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
