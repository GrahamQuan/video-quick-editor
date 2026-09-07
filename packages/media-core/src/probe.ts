import { basename, extname } from "node:path";
import { stat } from "node:fs/promises";
import { z } from "zod";
import type { AssetView, AudioInfo, VideoInfo } from "@video-quick-editor/shared";
import { parseRational } from "./time.js";
import { runProcess } from "./process.js";

const streamSchema = z
  .object({
    index: z.number().int(),
    codec_type: z.string(),
    codec_name: z.string().optional(),
    profile: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    pix_fmt: z.string().optional(),
    time_base: z.string().optional(),
    sample_aspect_ratio: z.string().optional(),
    avg_frame_rate: z.string().optional(),
    r_frame_rate: z.string().optional(),
    sample_rate: z.string().optional(),
    channels: z.number().optional(),
    channel_layout: z.string().optional(),
    color_transfer: z.string().optional(),
    bits_per_raw_sample: z.string().optional(),
    disposition: z.object({ attached_pic: z.number().optional() }).passthrough().optional(),
    side_data_list: z.array(z.object({ rotation: z.number().optional() }).passthrough()).optional(),
  })
  .passthrough();
const probeSchema = z.object({
  format: z
    .object({ duration: z.string().optional(), format_name: z.string().optional() })
    .passthrough(),
  streams: z.array(streamSchema),
  chapters: z.array(z.unknown()).optional(),
});

export interface ProbedAsset extends AssetView {
  path: string;
  container: "mp4" | "mov" | "mkv";
}

function containerFromProbe(path: string, formatName: string): ProbedAsset["container"] {
  const extension = extname(path).toLowerCase().slice(1);
  if (!["mp4", "mov", "mkv"].includes(extension))
    throw new Error(`暂不支持 .${extension || "(无扩展名)"} 容器`);
  if (extension === "mkv" && !formatName.includes("matroska"))
    throw new Error("扩展名与探测到的容器不一致");
  if ((extension === "mp4" || extension === "mov") && !/mov|mp4/u.test(formatName))
    throw new Error("扩展名与探测到的容器不一致");
  return extension as ProbedAsset["container"];
}

export async function probeAsset(
  ffprobePath: string,
  path: string,
  id: string,
): Promise<ProbedAsset> {
  const [result, fileStat] = await Promise.all([
    runProcess(ffprobePath, [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-show_chapters",
      "-of",
      "json",
      path,
    ]),
    stat(path),
  ]);
  const parsed = probeSchema.parse(JSON.parse(result.stdout) as unknown);
  const duration = Number(parsed.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("ffprobe 无法提供可靠媒体时长");
  const durationUs = Math.round(duration * 1_000_000);
  if (!Number.isSafeInteger(durationUs)) throw new Error("媒体时长超出安全范围");
  const videoStreams = parsed.streams.filter(
    (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  const audioStreams = parsed.streams.filter((stream) => stream.codec_type === "audio");
  const selectedVideo = videoStreams[0];
  if (
    !selectedVideo?.codec_name ||
    !selectedVideo.width ||
    !selectedVideo.height ||
    !selectedVideo.pix_fmt ||
    !selectedVideo.time_base
  ) {
    throw new Error("媒体没有可用的普通视频流");
  }
  const frameRate = parseRational(selectedVideo.avg_frame_rate ?? "");
  const rFrameRate = parseRational(selectedVideo.r_frame_rate ?? "");
  const rotation =
    selectedVideo.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? 0;
  const sarParts = (selectedVideo.sample_aspect_ratio ?? "1:1").split(":").map(Number);
  const sar = sarParts[0] && sarParts[1] ? sarParts[0] / sarParts[1] : 1;
  const displayWidth = Math.round(selectedVideo.width * sar);
  const video: VideoInfo = {
    codec: selectedVideo.codec_name,
    profile: selectedVideo.profile ?? null,
    width: selectedVideo.width,
    height: selectedVideo.height,
    displayWidth: Math.abs(rotation) % 180 === 90 ? selectedVideo.height : displayWidth,
    displayHeight: Math.abs(rotation) % 180 === 90 ? displayWidth : selectedVideo.height,
    pixelFormat: selectedVideo.pix_fmt,
    timeBase: selectedVideo.time_base,
    frameRate,
    variableFrameRate: Boolean(
      frameRate &&
      rFrameRate &&
      frameRate.numerator * rFrameRate.denominator !== rFrameRate.numerator * frameRate.denominator,
    ),
    bitDepth: selectedVideo.bits_per_raw_sample
      ? Number(selectedVideo.bits_per_raw_sample)
      : inferBitDepth(selectedVideo.pix_fmt),
    colorTransfer: selectedVideo.color_transfer ?? null,
    rotation,
  };
  const firstAudio = audioStreams[0];
  const sampleRate = Number(firstAudio?.sample_rate);
  const audio: AudioInfo | null =
    firstAudio?.codec_name && Number.isInteger(sampleRate) && sampleRate > 0 && firstAudio.channels
      ? {
          codec: firstAudio.codec_name,
          sampleRate,
          channels: firstAudio.channels,
          channelLayout: firstAudio.channel_layout ?? null,
        }
      : null;
  const warnings: string[] = [];
  if (videoStreams.length > 1)
    warnings.push(`仅使用第 1 条普通视频流（共 ${videoStreams.length} 条）`);
  if (audioStreams.length > 1) warnings.push(`仅使用第 1 条音频流（共 ${audioStreams.length} 条）`);
  if (parsed.chapters?.length) warnings.push("章节不会保留");
  if (video.rotation !== 0) warnings.push("带旋转 metadata：仅 copy 模式支持");
  if ((video.bitDepth ?? 8) > 8) warnings.push("高位深输入：仅 copy 模式支持");
  if (video.colorTransfer === "smpte2084" || video.colorTransfer === "arib-std-b67")
    warnings.push("HDR 输入：仅 copy 模式支持");
  return {
    id,
    path,
    fileName: basename(path),
    durationUs,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    previewUrl: `media://asset/${id}`,
    video,
    audio,
    warnings,
    container: containerFromProbe(path, parsed.format.format_name ?? ""),
  };
}

function inferBitDepth(pixelFormat: string): number | null {
  const match = /(?:p|le|be)(10|12|16)(?:le|be)?$/u.exec(pixelFormat);
  return match ? Number(match[1]) : 8;
}

export async function verifyOutput(
  ffprobePath: string,
  path: string,
  profile?: string,
  hasAudio?: boolean,
): Promise<void> {
  const result = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration,format_name:stream=codec_type,codec_name,pix_fmt,sample_rate,channels,width,height",
    "-of",
    "json",
    path,
  ]);
  const parsed = z
    .object({
      streams: z.array(z.object({ codec_type: z.string() }).passthrough()),
      format: z.object({ duration: z.string().optional(), format_name: z.string().optional() }),
    })
    .parse(JSON.parse(result.stdout) as unknown);
  if (!parsed.streams.some((stream) => stream.codec_type === "video"))
    throw new Error("导出验证失败：没有视频流");
  if (profile === "mp4-compatible") {
    const video = parsed.streams.find((s) => s.codec_type === "video");
    const audio = parsed.streams.find((s) => s.codec_type === "audio");
    if (
      !parsed.format.format_name?.includes("mp4") ||
      video?.codec_name !== "h264" ||
      video.pix_fmt !== "yuv420p" ||
      Boolean(audio) !== Boolean(hasAudio) ||
      (audio &&
        (audio.codec_name !== "aac" || audio.sample_rate !== "48000" || audio.channels !== 2))
    )
      throw new Error("Output does not match mp4-compatible profile");
  }
  if (!(Number(parsed.format.duration) > 0)) throw new Error("导出验证失败：时长无效");
}
