import type { ExportPlanView, ExportRequest, VideoInfo } from "@video-quick-editor/shared";
import type { ProbedAsset } from "./probe.js";
import { secondsArg } from "./time.js";

export interface ResolvedClip {
  asset: ProbedAsset;
  startUs: number;
  endUs: number;
}
export interface CommandStep {
  label: string;
  args: string[];
  expectedDurationUs: number;
}
export interface ExecutionPlan extends ExportPlanView {
  outputProfile?: ExportRequest["outputProfile"];
  hasAudio?: boolean;
  commands: CommandStep[];
  tempOutputPath: string;
  finalOutputPath: string;
}

export interface PlanOptions {
  watermarkResources?: Array<{ fontPath: string | null; textFilePath: string | null }>;
  ffmpegPath: string;
  clips: ResolvedClip[];
  request: ExportRequest;
  fontPath: string | null;
  textFilePath: string | null;
  tempDirectory: string;
  tempOutputPath: string;
  finalOutputPath: string;
}

export function validateRequest(
  request: ExportRequest,
  clips: ResolvedClip[],
  fontPath: string | null,
): void {
  if (clips.length !== request.clips.length || clips.length === 0) throw new Error("片段引用无效");
  for (const clip of clips) {
    if (clip.startUs < 0 || clip.startUs >= clip.endUs || clip.endUs > clip.asset.durationUs)
      throw new Error(`${clip.asset.fileName} 的片段时间超出媒体范围`);
  }
  if (request.mode === "accurate" && clips.length !== 1)
    throw new Error("accurate 模式只支持一个片段");
  if (
    request.outputProfile === "mp4-compatible" &&
    (request.mode === "copy" || request.videoCodec === "hevc")
  )
    throw new Error("mp4-compatible requires H.264 re-encoding; select source for copy / HEVC");
  if (
    request.mode === "copy" &&
    request.clips.some((clip) => (clip.watermark ?? request.watermark).enabled)
  )
    throw new Error("copy 模式不能添加水印，请改用重编码模式");
  if (request.clips.some((clip) => !clip.watermark && request.watermark.enabled) && !fontPath)
    throw new Error("启用水印时必须选择可读字体");
  if (request.mode !== "copy") {
    for (const clip of clips) {
      const video = clip.asset.video;
      if (video.rotation !== 0)
        throw new Error(`${clip.asset.fileName} 带旋转 metadata，重编码暂不支持`);
      if ((video.bitDepth ?? 8) > 8)
        throw new Error(`${clip.asset.fileName} 为高位深视频，重编码暂不支持`);
      if (video.colorTransfer === "smpte2084" || video.colorTransfer === "arib-std-b67")
        throw new Error(`${clip.asset.fileName} 为 HDR，重编码暂不支持`);
    }
  }
  if (
    request.outputProfile !== "mp4-compatible" &&
    request.mode === "accurate" &&
    clips[0]?.asset.audio &&
    clips[0].asset.audio.codec !== "aac"
  ) {
    throw new Error("accurate 第一版只支持 AAC 音频；请使用 normalize");
  }
  if (request.mode === "normalize" && !resolveFps(request, clips[0]!.asset.video))
    throw new Error("VFR 或帧率不可靠时必须显式设置 normalize fps");
  if (request.mode === "copy" && clips.length > 1) assertCopyCompatible(clips);
}

export function copyDifferences(first: ProbedAsset, next: ProbedAsset): string[] {
  const differences: string[] = [];
  const compare = (label: string, left: unknown, right: unknown): void => {
    if (left !== right) differences.push(`${label}: ${String(left)} ≠ ${String(right)}`);
  };
  compare("容器", first.container, next.container);
  compare("视频 Codec", first.video.codec, next.video.codec);
  compare("profile", first.video.profile, next.video.profile);
  compare(
    "尺寸",
    `${first.video.width}x${first.video.height}`,
    `${next.video.width}x${next.video.height}`,
  );
  compare("pixel format", first.video.pixelFormat, next.video.pixelFormat);
  compare("time base", first.video.timeBase, next.video.timeBase);
  compare(
    "frame rate",
    JSON.stringify(first.video.frameRate),
    JSON.stringify(next.video.frameRate),
  );
  compare("音轨存在性", Boolean(first.audio), Boolean(next.audio));
  if (first.audio && next.audio) {
    compare("音频 Codec", first.audio.codec, next.audio.codec);
    compare("采样率", first.audio.sampleRate, next.audio.sampleRate);
    compare("声道布局", first.audio.channelLayout, next.audio.channelLayout);
  }
  return differences;
}

function assertCopyCompatible(clips: ResolvedClip[]): void {
  const first = clips[0]!.asset;
  const problems = clips
    .slice(1)
    .flatMap((clip, index) =>
      copyDifferences(first, clip.asset).map((difference) => `片段 ${index + 2} ${difference}`),
    );
  if (problems.length) throw new Error(`copy 片段不兼容：\n${problems.join("\n")}`);
}

function codecArgs(codec: string, explicit: ExportRequest["videoCodec"]): string[] {
  const selected = explicit ?? (codec === "h264" || codec === "hevc" ? codec : null);
  if (selected === "h264") return ["-c:v", "libx264", "-preset", "medium", "-crf", "18"];
  if (selected === "hevc") return ["-c:v", "libx265", "-preset", "medium", "-crf", "20"];
  throw new Error(`视频 Codec ${codec} 没有默认重编码映射，请显式选择 H.264 或 HEVC`);
}

function resolveFps(request: ExportRequest, video: VideoInfo): string | null {
  if (request.normalize.fps?.trim()) {
    if (!/^(?:\d+(?:\.\d+)?|\d+\/\d+)$/u.test(request.normalize.fps.trim()))
      throw new Error("fps 必须是正数或正有理数");
    const [n, d = "1"] = request.normalize.fps.trim().split("/");
    if (!(Number(n) > 0 && Number(d) > 0)) throw new Error("fps must be positive");
    return request.normalize.fps.trim();
  }
  if (video.variableFrameRate || !video.frameRate || video.frameRate.numerator <= 0)
    return request.outputProfile === "mp4-compatible" ? "30" : null;
  return `${video.frameRate.numerator}/${video.frameRate.denominator}`;
}

function filterEscapePath(path: string): string {
  return path.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "'\\''");
}

function drawtext(
  watermark: ExportRequest["watermark"],
  fontPath: string,
  textFilePath: string,
): string {
  const positions = {
    "top-left": ["margin", "margin"],
    "top-right": ["w-text_w-margin", "margin"],
    "bottom-left": ["margin", "h-text_h-margin"],
    "bottom-right": ["w-text_w-margin", "h-text_h-margin"],
  } as const;
  const [x, y] = positions[watermark.position];
  const borderWidth = watermark.borderWidth ?? 1;
  return `drawtext=fontfile='${filterEscapePath(fontPath)}':textfile='${filterEscapePath(textFilePath)}':expansion=none:fontsize=${watermark.fontSize}:fontcolor=white:borderw=${borderWidth}:bordercolor=black:x=${x.replaceAll("margin", String(watermark.margin))}:y=${y.replaceAll("margin", String(watermark.margin))}`;
}

export function createExecutionPlan(options: PlanOptions): ExecutionPlan {
  const { clips, request, fontPath, textFilePath, tempDirectory, tempOutputPath, finalOutputPath } =
    options;
  validateRequest(request, clips, fontPath);
  const watermarkFilter = (index: number): string | null => {
    const watermark = request.clips[index]!.watermark ?? request.watermark;
    if (!watermark.enabled) return null;
    const resource = options.watermarkResources?.[index];
    const font = resource?.fontPath ?? fontPath;
    const text = resource?.textFilePath ?? textFilePath;
    if (!font || !text) throw new Error("启用水印时必须选择可读字体和文字文件");
    return drawtext(watermark, font, text);
  };
  const expectedDurationUs = clips.reduce((total, clip) => total + clip.endUs - clip.startUs, 0);
  const changes: string[] = [];
  const warnings = clips.flatMap((clip) => clip.asset.warnings);
  const compatible = request.outputProfile === "mp4-compatible";
  const muxArgs = compatible ? ["-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4"] : [];
  let commands: CommandStep[];
  if (request.mode === "copy") {
    warnings.push("copy 剪辑受关键帧/包边界限制，实际时长可能不同");
    const segments = clips.map((_, index) => `${tempDirectory}/segment-${index}.mkv`);
    const segmentCommands = clips.map((clip, index) => ({
      label: `准备 copy 片段 ${index + 1}/${clips.length}`,
      expectedDurationUs: clip.endUs - clip.startUs,
      args: [
        "-nostdin",
        "-y",
        "-ss",
        secondsArg(clip.startUs),
        "-t",
        secondsArg(clip.endUs - clip.startUs),
        "-i",
        clip.asset.path,
        "-map",
        "0:v:0",
        ...(clip.asset.audio ? ["-map", "0:a:0"] : []),
        "-c",
        "copy",
        segments[index]!,
      ],
    }));
    commands = [
      ...segmentCommands,
      {
        label: "拼接 copy 片段",
        expectedDurationUs,
        args: [
          "-nostdin",
          "-y",
          "-f",
          "concat",
          "-safe",
          "1",
          "-i",
          `${tempDirectory}/segments.ffconcat`,
          "-c",
          "copy",
          tempOutputPath,
        ],
      },
    ];
  } else if (request.mode === "accurate") {
    const clip = clips[0]!;
    const filters: string[] = [
      `[0:v:0]trim=start=${secondsArg(clip.startUs)}:end=${secondsArg(clip.endUs)},setpts=PTS-STARTPTS${compatible ? ",scale=trunc(iw*sar+0.5):ih,setsar=1,pad=ceil(iw/2)*2:ceil(ih/2)*2" : ""}[vbase]`,
    ];
    const watermark = watermarkFilter(0);
    const videoOut = watermark ? (filters.push(`[vbase]${watermark}[vout]`), "[vout]") : "[vbase]";
    if (clip.asset.audio)
      filters.push(
        `[0:a:0]atrim=start=${secondsArg(clip.startUs)}:end=${secondsArg(clip.endUs)},asetpts=PTS-STARTPTS[aout]`,
      );
    commands = [
      {
        label: "精确剪辑并编码",
        expectedDurationUs,
        args: [
          "-nostdin",
          "-y",
          "-i",
          clip.asset.path,
          "-filter_complex",
          filters.join(";"),
          "-map",
          videoOut,
          ...(clip.asset.audio
            ? [
                "-map",
                "[aout]",
                "-c:a",
                "aac",
                ...(compatible ? ["-ar", "48000", "-ac", "2", "-b:a", "192k"] : []),
              ]
            : []),
          ...codecArgs(clip.asset.video.codec, compatible ? "h264" : request.videoCodec),
          ...(compatible ? ["-fps_mode", "passthrough"] : []),
          ...muxArgs,
          tempOutputPath,
        ],
      },
    ];
    changes.push("视频将重编码；时间边界对齐实际帧/采样");
  } else {
    const first = clips[0]!.asset;
    const width =
      request.normalize.width ?? first.video.displayWidth + (first.video.displayWidth % 2);
    const height =
      request.normalize.height ?? first.video.displayHeight + (first.video.displayHeight % 2);
    if (width % 2 || height % 2) throw new Error("normalize 宽高必须是正偶数");
    const fps = resolveFps(request, first.video)!;
    if (
      compatible &&
      !request.normalize.fps &&
      (first.video.variableFrameRate || !first.video.frameRate)
    )
      warnings.push("VFR / unknown frame rate: normalize uses 30 fps");
    const args = ["-nostdin", "-y"];
    const audioInputIndexes: Array<number | null> = [];
    let inputIndex = 0;
    const allNoAudio = clips.every((clip) => !clip.asset.audio);
    for (const clip of clips) {
      args.push(
        "-ss",
        secondsArg(clip.startUs),
        "-t",
        secondsArg(clip.endUs - clip.startUs),
        "-i",
        clip.asset.path,
      );
      const videoInputIndex = inputIndex;
      inputIndex += 1;
      if (!allNoAudio && !clip.asset.audio) {
        args.push(
          "-f",
          "lavfi",
          "-t",
          secondsArg(clip.endUs - clip.startUs),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
        );
        audioInputIndexes.push(inputIndex);
        inputIndex += 1;
      } else audioInputIndexes.push(clip.asset.audio ? videoInputIndex : null);
    }
    const filters: string[] = [];
    let cursor = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index]!;
      const duration = secondsArg(clip.endUs - clip.startUs);
      filters.push(
        `[${cursor}:v:0]scale=trunc(iw*sar+0.5):ih,setsar=1,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps},setpts=PTS-STARTPTS${watermarkFilter(index) ? `,${watermarkFilter(index)}` : ""}[v${index}]`,
      );
      const audioIndex = audioInputIndexes[index];
      if (!allNoAudio && audioIndex !== null)
        filters.push(
          `[${audioIndex}:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
        );
      cursor += clip.asset.audio || allNoAudio ? 1 : 2;
    }
    const concatInputs = clips
      .map((_, index) => `[v${index}]${allNoAudio ? "" : `[a${index}]`}`)
      .join("");
    filters.push(
      `${concatInputs}concat=n=${clips.length}:v=1:a=${allNoAudio ? 0 : 1}[vcat]${allNoAudio ? "" : "[acat]"}`,
    );
    const videoOut = "[vcat]";
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      videoOut,
      ...(!allNoAudio
        ? ["-map", "[acat]", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k"]
        : []),
      ...codecArgs(first.video.codec, compatible ? "h264" : request.videoCodec),
      ...muxArgs,
      tempOutputPath,
    );
    commands = [{ label: "标准化并拼接", args, expectedDurationUs }];
    changes.push(`统一为 ${width}×${height}、SAR 1、${fps} fps`);
    if (!allNoAudio) changes.push("音频统一为 AAC、48 kHz、stereo、192 kb/s；短音频补静音");
  }
  if (compatible)
    changes.push("MP4 / H.264 / yuv420p / faststart; audio AAC 48 kHz stereo 192 kb/s");
  return {
    outputProfile: request.outputProfile,
    hasAudio: clips.some((clip) => Boolean(clip.asset.audio)),
    mode: request.mode,
    outputPath: finalOutputPath,
    expectedDurationUs,
    stages: [
      "validating",
      "preparing",
      ...commands.map((command) => command.label),
      "verifying",
      "publish",
    ],
    changes,
    warnings: [...new Set(warnings)],
    commands,
    tempOutputPath,
    finalOutputPath,
  };
}
