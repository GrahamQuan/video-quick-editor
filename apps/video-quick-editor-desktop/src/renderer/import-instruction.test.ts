import { describe, it, expect } from "vitest";
import { parseImportInstruction } from "./import-instruction.js";

describe("local import instructions", () => {
  it("extracts quoted paths and retains editing/export authorization without paths", () => {
    const result = parseImportInstruction(
      "请导入 `/Users/me/My Videos/旅行.mp4`，然后保留 2 到 5 秒，不要导出",
    );
    expect(parseImportInstruction("导入“/tmp/带 空格.mp4”，然后裁剪")?.paths).toEqual([
      "/tmp/带 空格.mp4",
    ]);
    expect(result?.paths).toEqual(["/Users/me/My Videos/旅行.mp4"]);
    expect(result?.instruction).toContain("保留 2 到 5 秒，不要导出");
    expect(result?.instruction).not.toContain("/Users/");
  });
  it("supports folders, multiple paths and English commands", () => {
    expect(
      parseImportInstruction('Import "~/Movies" and file:///tmp/clip.mp4, then combine.')?.paths,
    ).toEqual(["~/Movies", "file:///tmp/clip.mp4"]);
    expect(parseImportInstruction("导入 /tmp/视频.mp4，然后裁剪")?.paths).toEqual([
      "/tmp/视频.mp4",
    ]);
  });
  it("does not infer import authorization from arbitrary path mentions", () => {
    expect(parseImportInstruction("不要导入 /tmp/a.mp4")).toBeNull();
    expect(parseImportInstruction("What is /tmp/a.mp4?")).toBeNull();
    expect(parseImportInstruction("Trim the first clip")).toBeNull();
  });
});

it("recognizes numbered editing requests with reversed curly quotes and preserves each range", () => {
  const result = parseImportInstruction(`视频剪辑和拼接
1. ’/Users/example/Downloads/first_combined.mp4‘，这个视频从 第一秒 到 第三秒
2. ‘/Users/example/Downloads/second.mp4’ 这个视频从第5秒到第10秒

剪辑完成后拼接，最后输出视频`);
  expect(result?.paths).toEqual([
    "/Users/example/Downloads/first_combined.mp4",
    "/Users/example/Downloads/second.mp4",
  ]);
  expect(result?.instruction).toContain("1. [imported source 1]，这个视频从 第一秒 到 第三秒");
  expect(result?.instruction).toContain("2. [imported source 2] 这个视频从第5秒到第10秒");
  expect(result?.instruction).toContain("最后输出视频");
  expect(result?.instruction).not.toContain("/Users/");
});
it("does not use action words inside a filename as import authorization", () => {
  expect(parseImportInstruction('What is "/tmp/trim.mp4"?')).toBeNull();
  expect(parseImportInstruction('如何剪辑 "/tmp/clip.mp4"？')).toBeNull();
  expect(parseImportInstruction('剪辑视频，但不要自动导入 "/tmp/clip.mp4"')).toBeNull();
});
