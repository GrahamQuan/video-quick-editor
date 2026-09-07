import { describe, expect, it } from "vitest";
import type { ExportJob } from "@video-quick-editor/shared";
import { formatProgress, jobKind, jobPhaseLabel, jobStateLabel } from "./jobs.js";

describe("任务进度格式", () => {
  it.each([
    [null, "--"],
    [0, "0%"],
    [0.2374, "23.7%"],
    [0.999, "99.9%"],
    [1, "100%"],
  ])("将 %s 格式化为 %s", (progress, expected) => {
    expect(formatProgress(progress)).toBe(expected);
  });
});

describe("localized job labels", () => {
  const job = {
    state: "running",
    request: { clips: [{}, {}] },
  } as ExportJob;

  it("uses English by default", () => {
    expect(jobKind(job)).toBe("Combine");
    expect(jobStateLabel(job)).toBe("Combine in progress");
    expect(jobPhaseLabel("标准化并拼接", "en")).toBe("Normalizing and combining");
  });

  it("supports Simplified Chinese", () => {
    expect(jobKind(job, "zh-CN")).toBe("组合");
    expect(jobStateLabel(job, "zh-CN")).toBe("正在组合");
    expect(jobPhaseLabel("标准化并拼接", "zh-CN")).toBe("标准化并拼接");
  });
});
