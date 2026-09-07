import { describe, expect, it } from "vitest";
import type { ExportRequest } from "@video-quick-editor/shared";
import { copyDifferences, createExecutionPlan, type ProbedAsset } from "../src/index.js";

const asset: ProbedAsset = {
  id: "00000000-0000-4000-8000-000000000001",
  path: "/tmp/素材 a.mp4",
  fileName: "素材 a.mp4",
  container: "mp4",
  durationUs: 5_000_000,
  size: 10,
  mtimeMs: 1,
  previewUrl: "media://asset/id",
  warnings: [],
  video: {
    codec: "h264",
    profile: "High",
    width: 1920,
    height: 1080,
    displayWidth: 1920,
    displayHeight: 1080,
    pixelFormat: "yuv420p",
    timeBase: "1/12800",
    frameRate: { numerator: 25, denominator: 1 },
    variableFrameRate: false,
    bitDepth: 8,
    colorTransfer: "bt709",
    rotation: 0,
  },
  audio: { codec: "aac", sampleRate: 48_000, channels: 2, channelLayout: "stereo" },
};
const request: ExportRequest = {
  clips: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      assetId: asset.id,
      startUs: 250_000,
      endUs: 2_000_000,
    },
  ],
  mode: "accurate",
  modeWasManuallySelected: false,
  watermark: {
    enabled: true,
    text: "中文:%\\'",
    fontId: "00000000-0000-4000-8000-000000000003",
    position: "bottom-right",
    fontSize: 32,
    borderWidth: 1,
    margin: 24,
  },
  output: null,
  videoCodec: null,
  normalize: { width: null, height: null, fps: null },
};

describe("执行计划", () => {
  it.each([0, 1, 4])("准确剪辑使用自定义描边 %i、textfile 与 argv", (borderWidth) => {
    const plan = createExecutionPlan({
      ffmpegPath: "/ffmpeg",
      clips: [{ asset, startUs: 250_000, endUs: 2_000_000 }],
      request: { ...request, watermark: { ...request.watermark, borderWidth } },
      fontPath: "/字体/字'体.ttf",
      textFilePath: "/tmp/watermark.txt",
      tempDirectory: "/tmp/task",
      tempOutputPath: "/tmp/task/out.mp4",
      finalOutputPath: "/Downloads/out.mp4",
    });
    expect(plan.expectedDurationUs).toBe(1_750_000);
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]?.expectedDurationUs).toBe(1_750_000);
    expect(plan.commands[0]?.args.join(" ")).toContain("trim=start=0.250000:end=2.000000");
    expect(plan.commands[0]?.args.join(" ")).toContain("textfile=");
    expect(plan.commands[0]?.args.join(" ")).toContain(
      `fontcolor=white:borderw=${borderWidth}:bordercolor=black`,
    );
    expect(plan.commands[0]?.args.join(" ")).not.toContain("box=1");
    expect(plan.commands[0]?.args).toContain("/tmp/素材 a.mp4");
  });

  it("copy 冲突时给出字段级差异", () => {
    const other = structuredClone(asset);
    other.video.width = 1280;
    other.audio!.sampleRate = 44_100;
    expect(copyDifferences(asset, other)).toEqual(
      expect.arrayContaining([expect.stringContaining("尺寸"), expect.stringContaining("采样率")]),
    );
  });

  it("阻止 copy 与水印组合", () => {
    expect(() =>
      createExecutionPlan({
        ffmpegPath: "/ffmpeg",
        clips: [{ asset, startUs: 0, endUs: 1_000_000 }],
        request: { ...request, mode: "copy" },
        fontPath: "/font.ttf",
        textFilePath: "/text",
        tempDirectory: "/tmp/task",
        tempOutputPath: "/tmp/task/out.mp4",
        finalOutputPath: "/tmp/out.mp4",
      }),
    ).toThrow("copy 模式不能添加水印");
  });
});
