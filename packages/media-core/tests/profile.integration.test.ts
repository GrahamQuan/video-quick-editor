import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { it, expect } from "vitest";
import { createExecutionPlan, executePlan, probeAsset, runProcess } from "../src/index.js";
import type { ExportRequest } from "@video-quick-editor/shared";
const ffmpeg = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg",
  ffprobe = process.env.FFPROBE_PATH ?? "/opt/homebrew/bin/ffprobe";
it("MOV / PCM and MKV inputs become real compatible MP4; normalize pads mixed audio", async () => {
  const root = await mkdtemp(join(tmpdir(), "mp4-profile-"));
  try {
    const a = join(root, "A.mov"),
      b = join(root, "B.mkv");
    await runProcess(ffmpeg, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x240:r=25:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "pcm_s16le",
      a,
    ]);
    await runProcess(ffmpeg, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=640x360:r=30:d=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      b,
    ]);
    const hash = async (path: string) =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    const before = await hash(a);
    const assets = await Promise.all([
      probeAsset(ffprobe, a, randomUUID()),
      probeAsset(ffprobe, b, randomUUID()),
    ]);
    for (const indexes of [[0], [1], [0, 1]]) {
      const selected = indexes.map((i) => assets[i]!);
      const request: ExportRequest = {
        outputProfile: "mp4-compatible",
        clips: selected.map((asset) => ({
          id: randomUUID(),
          assetId: asset.id,
          startUs: 0,
          endUs: 2_000_000,
        })),
        mode: indexes.length > 1 ? "normalize" : "accurate",
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
      const temp = join(root, `work-${indexes.join("")}`);
      await mkdir(temp);
      const output = join(root, `result-${indexes.join("")}.mp4`);
      const plan = createExecutionPlan({
        ffmpegPath: ffmpeg,
        clips: selected.map((asset) => ({ asset, startUs: 0, endUs: 2_000_000 })),
        request,
        fontPath: null,
        textFilePath: null,
        tempDirectory: temp,
        tempOutputPath: join(temp, "out.mp4"),
        finalOutputPath: output,
      });
      await executePlan({
        ffmpegPath: ffmpeg,
        ffprobePath: ffprobe,
        plan,
        tempDirectory: temp,
        replaceAuthorized: false,
        signal: new AbortController().signal,
        onPhase: () => {},
      });
      const result = await probeAsset(ffprobe, output, randomUUID());
      expect(result.container).toBe("mp4");
      expect(result.video.codec).toBe("h264");
      expect(result.video.pixelFormat).toBe("yuv420p");
      expect(Math.abs(result.durationUs - 2_000_000 * indexes.length)).toBeLessThan(100000);
      if (indexes.includes(0)) {
        expect(result.audio).toMatchObject({ codec: "aac", sampleRate: 48000, channels: 2 });
      } else expect(result.audio).toBeNull();
      const bytes = await readFile(output);
      expect(bytes.indexOf(Buffer.from("moov"))).toBeLessThan(bytes.indexOf(Buffer.from("mdat")));
    }
    expect(await hash(a)).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("25 second trimmed combination with Chinese watermark validates real output", async () => {
  const root = await mkdtemp(join(tmpdir(), "watermark-profile-"));
  try {
    const a = join(root, "A.mp4"),
      b = join(root, "B.mp4");
    for (const [path, duration, color] of [
      [a, 22, "red"],
      [b, 12, "blue"],
    ] as const)
      await runProcess(ffmpeg, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=320x240:r=25:d=${duration}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        path,
      ]);
    const assets = await Promise.all([
      probeAsset(ffprobe, a, randomUUID()),
      probeAsset(ffprobe, b, randomUUID()),
    ]);
    const fontPath = process.env.FONT_PATH ?? "/System/Library/Fonts/STHeiti Medium.ttc";
    const watermark = {
      enabled: true,
      text: "旅行记录",
      fontId: randomUUID(),
      position: "bottom-right" as const,
      fontSize: 32,
      borderWidth: 1,
      margin: 24,
    };
    const { validateWatermarkFont } = await import("../src/watermark.js");
    validateWatermarkFont(watermark, fontPath, 320, 240);
    expect(() =>
      validateWatermarkFont({ ...watermark, text: "旅行记录".repeat(10) }, fontPath, 320, 240),
    ).toThrow("Watermark does not fit");
    const request: ExportRequest = {
      outputProfile: "mp4-compatible",
      clips: assets.map((asset, i) => ({
        id: randomUUID(),
        assetId: asset.id,
        watermark: { ...watermark, enabled: i === 0 },
        startUs: i === 0 ? 5_000_000 : 0,
        endUs: i === 0 ? 20_000_000 : 10_000_000,
      })),
      mode: "normalize",
      modeWasManuallySelected: false,
      watermark,
      output: null,
      videoCodec: null,
      normalize: { width: null, height: null, fps: null },
    };
    const temp = join(root, "work");
    await mkdir(temp);
    const textPath = join(temp, "watermark.txt");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(textPath, watermark.text);
    const output = join(root, "combined.mp4");
    const plan = createExecutionPlan({
      ffmpegPath: ffmpeg,
      clips: assets.map((asset, i) => ({
        asset,
        startUs: request.clips[i]!.startUs,
        endUs: request.clips[i]!.endUs,
      })),
      request,
      fontPath,
      textFilePath: textPath,
      tempDirectory: temp,
      tempOutputPath: join(temp, "out.mp4"),
      finalOutputPath: output,
    });
    expect(plan.expectedDurationUs).toBe(25_000_000);
    await executePlan({
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      plan,
      tempDirectory: temp,
      replaceAuthorized: false,
      signal: new AbortController().signal,
      onPhase: () => {},
    });
    const result = await probeAsset(ffprobe, output, randomUUID());
    expect(Math.abs(result.durationUs - 25_000_000)).toBeLessThan(80000);
    expect(result.video.codec).toBe("h264");
    const { execFileSync } = await import("node:child_process");
    const brightPixels = (at: string): number => {
      const pixels = execFileSync(ffmpeg, [
        "-v",
        "error",
        "-ss",
        at,
        "-i",
        output,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      let count = 0;
      for (let i = 0; i < pixels.length; i += 3)
        if (pixels[i]! > 200 && pixels[i + 1]! > 200 && pixels[i + 2]! > 200) count++;
      return count;
    };
    expect(brightPixels("1")).toBeGreaterThan(20);
    expect(brightPixels("16")).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
