import { randomUUID } from "node:crypto";
import {
  agentToolSchemas,
  watermarkSchema,
  draftRequestSchema,
  exportRequestSchema,
  toolResultSchema,
  type AssetView,
  type EditorDraft,
  type ExportJob,
  type ExportRequest,
  type OutputSelection,
  type ToolResult,
  type AgentToolName,
} from "@video-quick-editor/shared";

export class ServiceError extends Error {
  constructor(
    public code:
      | "INVALID_ARGUMENT"
      | "ASSET_NOT_FOUND"
      | "STALE_REVISION"
      | "PLAN_EXPIRED"
      | "UNSUPPORTED_MEDIA"
      | "FONT_REQUIRED"
      | "OUTPUT_CONFLICT"
      | "TOOLS_UNAVAILABLE"
      | "EXPORT_FAILED",
    message: string,
  ) {
    super(message);
  }
}
interface Dependencies {
  assets: () => AssetView[];
  fontAvailable: (id: string | null) => boolean;
  output: (token: string) => OutputSelection | null;
  plan: (request: ExportRequest) => Promise<{
    expectedDurationUs: number;
    outputPath: string;
    changes: string[];
    warnings: string[];
  }>;
  start: (request: ExportRequest) => Promise<ExportJob>;
  jobs: () => ExportJob[];
  cancel: (id: string) => void;
  preview: (input: {
    assetId: string;
    atUs: number;
    watermark: EditorDraft["request"]["watermark"];
  }) => Promise<string>;
  emit: (draft: EditorDraft) => void;
}
export class EditorService {
  draft: EditorDraft = {
    revision: 0,
    operation: "trim",
    combineClipIds: [],
    combineInitialized: false,
    combineOrderCustomized: false,
    selectedClipId: null,
    request: {
      outputProfile: "mp4-compatible",
      clips: [],
      mode: "accurate",
      modeWasManuallySelected: false,
      watermark: {
        enabled: false,
        text: "",
        fontId: null,
        position: "bottom-left",
        fontSize: 24,
        borderWidth: 1,
        margin: 24,
      },
      output: null,
      videoCodec: null,
      normalize: { width: null, height: null, fps: null },
    },
  };
  private plans = new Map<string, { revision: number; request: ExportRequest }>();
  private requests = new Map<string, { planId: string; result: Promise<ExportJob> }>();
  constructor(private deps: Dependencies) {}
  snapshot() {
    return structuredClone(this.draft);
  }
  private revision(value: number) {
    if (value !== this.draft.revision)
      throw new ServiceError(
        "STALE_REVISION",
        "The editor changed. Read current context before continuing.",
      );
  }
  update(
    expectedRevision: number,
    raw: unknown,
    selectedClipId: string | null = this.draft.selectedClipId,
    selection: {
      operation?: "trim" | "combine" | undefined;
      combineClipIds?: string[] | undefined;
      combineInitialized?: boolean | undefined;
      combineOrderCustomized?: boolean | undefined;
    } = {},
  ) {
    this.revision(expectedRevision);
    const request = draftRequestSchema.parse(raw);
    const ids = new Set<string>();
    for (const clip of request.clips) {
      const asset = this.deps.assets().find((a) => a.id === clip.assetId);
      if (!asset) throw new ServiceError("ASSET_NOT_FOUND", "Unknown asset ID");
      if (clip.endUs > asset.durationUs || ids.has(clip.id))
        throw new ServiceError("INVALID_ARGUMENT", "Invalid clip range or duplicate clip ID");
      ids.add(clip.id);
    }

    if (
      request.output &&
      JSON.stringify(this.deps.output(request.output.token)) !== JSON.stringify(request.output)
    )
      throw new ServiceError("OUTPUT_CONFLICT", "Unknown output token");
    if (
      request.outputProfile === "mp4-compatible" &&
      (request.mode === "copy" || request.videoCodec === "hevc")
    )
      throw new ServiceError(
        "INVALID_ARGUMENT",
        "MP4 compatible requires H.264 re-encoding. Select source for copy / HEVC.",
      );
    const combineClipIds = (selection.combineClipIds ?? this.draft.combineClipIds).filter((id) =>
      ids.has(id),
    );
    if (new Set(combineClipIds).size !== combineClipIds.length)
      throw new ServiceError("INVALID_ARGUMENT", "Duplicate combine clip IDs");
    const canCombine = new Set(request.clips.map((c) => c.assetId)).size >= 2;
    const operation = canCombine ? (selection.operation ?? this.draft.operation) : "trim";
    if (!request.modeWasManuallySelected)
      request.mode =
        operation === "combine" && combineClipIds.length > 1 ? "normalize" : "accurate";
    this.draft = {
      operation: canCombine ? (selection.operation ?? this.draft.operation) : "trim",
      combineClipIds,
      combineInitialized: selection.combineInitialized ?? this.draft.combineInitialized,
      combineOrderCustomized: selection.combineOrderCustomized ?? this.draft.combineOrderCustomized,
      revision: this.draft.revision + 1,
      request,
      selectedClipId: request.clips.some((c) => c.id === selectedClipId)
        ? selectedClipId
        : (request.clips[0]?.id ?? null),
    };
    this.plans.clear();
    this.deps.emit(this.snapshot());
    return this.snapshot();
  }
  context() {
    const draft = this.snapshot();
    if (draft.request.output) draft.request.output.displayPath = "Authorized output";
    return {
      draft,
      assets: this.deps.assets().map(({ previewUrl: _previewUrl, ...a }) => a),
      fontAvailable: this.deps.fontAvailable(
        (
          draft.request.clips.find((clip) => clip.id === draft.selectedClipId)?.watermark ??
          draft.request.watermark
        ).fontId,
      ),
    };
  }
  async call(name: AgentToolName, raw: unknown): Promise<ToolResult> {
    try {
      return toolResultSchema.parse({ ok: true, data: await this.execute(name, raw) });
    } catch (caught) {
      let e = caught;
      if (!(e instanceof ServiceError) && e instanceof Error) {
        if (e.message.startsWith("TOOLS_UNAVAILABLE"))
          e = new ServiceError("TOOLS_UNAVAILABLE", e.message);
        else if (/HDR|高位深|旋转/u.test(e.message))
          e = new ServiceError(
            "UNSUPPORTED_MEDIA",
            "HDR, high bit depth or rotation metadata cannot be re-encoded; choose a supported input or source/copy / HDR、高位深或旋转 metadata 暂不支持重编码",
          );
        else if (/导入后已变更/u.test(e.message))
          e = new ServiceError(
            "PLAN_EXPIRED",
            "Source changed since import. Reimport before planning / 源文件已变更，请重新导入",
          );
        else if (/FONT_REQUIRED|字体/u.test(e.message))
          e = new ServiceError(
            "FONT_REQUIRED",
            "Choose a readable font containing the watermark glyphs / 请选用包含水印字形的可读字体",
          );
        else if (/INVALID_ARGUMENT|超出画面/u.test(e.message))
          e = new ServiceError(
            "INVALID_ARGUMENT",
            "Watermark does not fit; reduce text, size or margin / 水印超出画面，请缩短文字或减小字号、边距",
          );
        else if (/EEXIST|输出|EACCES/u.test(e.message))
          e = new ServiceError(
            "OUTPUT_CONFLICT",
            "Output is unavailable or conflicts; choose another output / 输出不可用或冲突，请重新选择",
          );
        else if (/工具不可用|ENOENT/u.test(e.message))
          e = new ServiceError(
            "TOOLS_UNAVAILABLE",
            "Check FFmpeg tools in Settings / 请在设置检查 FFmpeg",
          );
      }
      return {
        ok: false,
        error: {
          code:
            e instanceof ServiceError
              ? e.code
              : e instanceof Error && e.name === "ZodError"
                ? "INVALID_ARGUMENT"
                : "UNSUPPORTED_MEDIA",
          message:
            e instanceof ServiceError
              ? e.message
              : "Operation failed validation. Check media, font, output settings and tool availability.",
          retryable: e instanceof ServiceError && e.code === "STALE_REVISION",
        },
      };
    }
  }
  private async execute(name: AgentToolName, raw: unknown): Promise<unknown> {
    switch (name) {
      case "get_editor_context":
        agentToolSchemas[name].parse(raw);
        return this.context();
      case "set_timeline": {
        const i = agentToolSchemas[name].parse(raw);
        const request = {
          ...this.draft.request,
          clips: i.clips.map((clip) => ({
            ...clip,
            watermark:
              clip.watermark ??
              this.draft.request.clips.find((old) => old.id === clip.id)?.watermark,
          })),
        };
        if (!request.modeWasManuallySelected)
          request.mode = i.clips.length > 1 ? "normalize" : "accurate";
        this.update(i.expectedRevision, request);
        return this.context();
      }
      case "set_watermark": {
        const i = agentToolSchemas[name].parse(raw);
        this.revision(i.expectedRevision);
        if (i.watermark.enabled && !this.deps.fontAvailable(i.watermark.fontId))
          throw new ServiceError(
            "FONT_REQUIRED",
            "Choose a readable font with all required glyphs in the editor / 请在编辑器选择包含所用字形的字体",
          );
        watermarkSchema.parse(i.watermark);
        const clipId = this.draft.selectedClipId;
        if (!clipId) throw new ServiceError("INVALID_ARGUMENT", "Select a clip first");
        this.update(i.expectedRevision, {
          ...this.draft.request,
          clips: this.draft.request.clips.map((clip) =>
            clip.id === clipId ? { ...clip, watermark: i.watermark } : clip,
          ),
        });
        return this.context();
      }
      case "set_output": {
        const { expectedRevision, outputToken, ...changes } = agentToolSchemas[name].parse(raw);
        let output = this.draft.request.output;
        if (outputToken !== undefined) {
          output = outputToken ? this.deps.output(outputToken) : null;
          if (outputToken && !output)
            throw new ServiceError("OUTPUT_CONFLICT", "Unknown output token");
        }
        this.update(expectedRevision, {
          ...this.draft.request,
          ...changes,
          output,
          modeWasManuallySelected: changes.mode ? true : this.draft.request.modeWasManuallySelected,
        });
        return this.context();
      }
      case "preview_frame": {
        const i = agentToolSchemas[name].parse(raw);
        this.revision(i.revision);
        const clip = this.draft.request.clips.find((c) => c.id === i.clipId);
        if (!clip || i.atUs < clip.startUs || i.atUs >= clip.endUs)
          throw new ServiceError(
            "INVALID_ARGUMENT",
            "Preview time must lie inside the selected clip",
          );
        return {
          previewUrl: await this.deps.preview({
            assetId: clip.assetId,
            atUs: i.atUs,
            watermark: clip.watermark ?? this.draft.request.watermark,
          }),
        };
      }
      case "plan_export": {
        const i = agentToolSchemas[name].parse(raw);
        this.revision(i.revision);
        const request = structuredClone(this.draft.request);
        request.clips = i.clipIds.map((id) => {
          const c = request.clips.find((c) => c.id === id);
          if (!c) throw new ServiceError("INVALID_ARGUMENT", "Unknown clip ID");
          return c;
        });
        if (!request.modeWasManuallySelected)
          request.mode = request.clips.length > 1 ? "normalize" : "accurate";
        request.taskKind = request.clips.length === 1 ? "trim" : "combine";
        const plan = await this.deps.plan(exportRequestSchema.parse(request));
        this.revision(i.revision);
        const planId = randomUUID();
        this.plans.set(planId, { revision: i.revision, request });
        return {
          planId,
          expectedDurationUs: plan.expectedDurationUs,
          outputName: plan.outputPath.split(/[\\/]/u).at(-1),
          changes: plan.changes,
          warnings: plan.warnings,
        };
      }
      case "start_export": {
        const i = agentToolSchemas[name].parse(raw);
        const old = this.requests.get(i.requestId);
        if (old) {
          if (old.planId !== i.planId)
            throw new ServiceError("INVALID_ARGUMENT", "requestId already belongs to another plan");
          const accepted = await old.result;
          const job = this.deps.jobs().find((j) => j.id === accepted.id) ?? accepted;
          return { jobId: job.id, state: job.state };
        }
        const plan = this.plans.get(i.planId);
        if (!plan || plan.revision !== this.draft.revision)
          throw new ServiceError("PLAN_EXPIRED", "Plan expired. Read context and plan again.");
        const result = (async () => {
          await this.deps.plan(plan.request);
          if (plan.revision !== this.draft.revision)
            throw new ServiceError("PLAN_EXPIRED", "Editor changed during validation");
          return await this.deps.start({
            ...structuredClone(plan.request),
            requestId: i.requestId,
          });
        })();
        this.requests.set(i.requestId, { planId: i.planId, result });
        const job = await result;
        return { jobId: job.id, state: job.state };
      }
      case "get_export_jobs": {
        const i = agentToolSchemas[name].parse(raw);
        return this.deps
          .jobs()
          .filter((j) => !i.jobIds || i.jobIds.includes(j.id))
          .map((j) => ({
            jobId: j.id,
            state: j.state,
            taskKind: j.request.taskKind ?? (j.request.clips.length === 1 ? "trim" : "combine"),
            clipCount: j.request.clips.length,
            expectedDurationUs: j.request.clips.reduce(
              (sum, clip) => sum + clip.endUs - clip.startUs,
              0,
            ),
            queueSequence: j.queueSequence,
            progress: j.progress,
            outputName: j.resultPath?.split(/[\\/]/u).at(-1) ?? j.outputName ?? null,
            error: j.error ? "Export failed; inspect local diagnostics" : null,
          }));
      }
      case "cancel_export": {
        const i = agentToolSchemas[name].parse(raw);
        this.deps.cancel(i.jobId);
        return this.execute("get_export_jobs", { jobIds: [i.jobId] });
      }
    }
  }
}
