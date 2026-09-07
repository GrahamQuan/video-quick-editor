import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExportRequest } from "@video-quick-editor/shared";
import {
  createExecutionPlan,
  executePlan,
  probeAsset,
  runProcess,
  type ExecutionPlan,
} from "../src/index.js";

const ffmpeg = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";
const ffprobe = process.env.FFPROBE_PATH ?? "/opt/homebrew/bin/ffprobe";
let available = true;
let directory = "";

beforeAll(async () => {
  try {
    await Promise.all([access(ffmpeg), access(ffprobe)]);
    directory = await mkdtemp(join(tmpdir(), "video-quick-editor-media-"));
  } catch {
    available = false;
  }
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("真实 FFmpeg media integration", () => {
  it("中断进程后删除临时目录和半成品", async () => {
    const root = await mkdtemp(join(tmpdir(), "video-quick-editor-cancel-"));
    const temp = join(root, "work");
    const staged = join(temp, "partial.mp4");
    const output = join(root, "result.mp4");
    const fakeFfmpeg = join(root, "fake-ffmpeg.js");
    await mkdir(temp);
    await writeFile(staged, "partial", "utf8");
    await writeFile(
      fakeFfmpeg,
      "#!/usr/bin/env node\nsetInterval(() => process.stdout.write('out_time_us=100000\\n'), 20);\n",
      "utf8",
    );
    await chmod(fakeFfmpeg, 0o700);
    const plan: ExecutionPlan = {
      mode: "accurate",
      outputPath: output,
      expectedDurationUs: 10_000_000,
      stages: [],
      changes: [],
      warnings: [],
      commands: [{ label: "模拟裁剪", args: [staged], expectedDurationUs: 10_000_000 }],
      tempOutputPath: staged,
      finalOutputPath: output,
    };
    const controller = new AbortController();
    const execution = executePlan({
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfmpeg,
      plan,
      tempDirectory: temp,
      replaceAuthorized: false,
      signal: controller.signal,
      onPhase: () => undefined,
    });
    setTimeout(() => controller.abort(), 80);
    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    await expect(access(temp)).rejects.toBeDefined();
    await expect(access(output)).rejects.toBeDefined();
    await rm(root, { recursive: true, force: true });
  });

  it("生成 fixture，精确剪辑并验证输出", async () => {
    if (!available) return;
    const input = join(directory, "空 格'中文.mp4");
    const temp = join(directory, "work");
    const staged = join(temp, "output.mp4");
    const output = join(directory, "result.mp4");
    await runProcess(ffmpeg, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x240:r=25:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      input,
    ]);
    const asset = await probeAsset(ffprobe, input, "00000000-0000-4000-8000-000000000001");
    const request: ExportRequest = {
      clips: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          assetId: asset.id,
          startUs: 250_000,
          endUs: 1_250_000,
        },
      ],
      mode: "accurate",
      modeWasManuallySelected: false,
      watermark: {
        enabled: false,
        text: "",
        fontId: null,
        position: "bottom-right",
        fontSize: 32,
        borderWidth: 1,
        margin: 24,
      },
      output: null,
      videoCodec: null,
      normalize: { width: null, height: null, fps: null },
    };
    const plan = createExecutionPlan({
      ffmpegPath: ffmpeg,
      clips: [{ asset, startUs: 250_000, endUs: 1_250_000 }],
      request,
      fontPath: null,
      textFilePath: null,
      tempDirectory: temp,
      tempOutputPath: staged,
      finalOutputPath: output,
    });
    await executePlan({
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      plan,
      tempDirectory: temp,
      replaceAuthorized: false,
      signal: new AbortController().signal,
      onPhase: () => undefined,
    });
    const result = await probeAsset(ffprobe, output, "00000000-0000-4000-8000-000000000003");
    expect(result.durationUs).toBeGreaterThan(850_000);
    expect(result.durationUs).toBeLessThan(1_150_000);
    expect(result.video.width).toBe(320);
  }, 30_000);
});
