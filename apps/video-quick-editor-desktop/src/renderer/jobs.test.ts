import { describe, expect, it } from "vitest";
import { formatProgress } from "./jobs.js";

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
