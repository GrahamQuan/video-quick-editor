import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allocateOutputPath, assertOutputNotInput, defaultOutputName } from "../src/output.js";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map(async (path) => await rm(path, { recursive: true, force: true })),
  );
});

describe("输出保护", () => {
  it("按 _2 递增且保留中文文件名", async () => {
    const directory = await mkdtemp(join(tmpdir(), "video-quick-editor-output-"));
    directories.push(directory);
    await writeFile(join(directory, "中文_clip.mp4"), "");
    expect(await allocateOutputPath(directory, "中文_clip.mp4")).toBe(
      join(directory, "中文_clip_2.mp4"),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 9, 5, 3));
    expect(defaultOutputName("中文.mp4", 2)).toBe("2026_09_07--09_05_03.mp4");
    expect(defaultOutputName("中文.mov", 1, "mp4-compatible")).toBe("2026_09_07--09_05_03.mp4");
    expect(defaultOutputName("中文.mov", 1)).toBe("2026_09_07--09_05_03.mov");
    await writeFile(join(directory, "2026_09_07--09_05_03.mp4"), "existing");
    expect(await allocateOutputPath(directory, defaultOutputName("中文.mp4", 1))).toBe(
      join(directory, "2026_09_07--09_05_03_2.mp4"),
    );
  });

  it("拒绝直接覆盖输入", async () => {
    await expect(assertOutputNotInput("/tmp/input.mp4", ["/tmp/input.mp4"])).rejects.toThrow(
      "输出不能覆盖输入文件",
    );
  });
});
