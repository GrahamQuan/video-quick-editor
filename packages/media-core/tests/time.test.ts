import { describe, expect, it } from "vitest";
import { formatTime, parseTimeToUs } from "../src/time.js";

describe("微秒时间语义", () => {
  it.each([
    ["0", 0],
    ["1.25", 1_250_000],
    ["00:00:01.250", 1_250_000],
    ["12:34:56.123456", 45_296_123_456],
  ])("解析 %s", (input, expected) => {
    expect(parseTimeToUs(input)).toBe(expected);
  });

  it.each(["", "-1", "NaN", "00:60:00", "00:00:60", "1:2:3"])("拒绝非法时间 %s", (input) => {
    expect(() => parseTimeToUs(input)).toThrow();
  });

  it("格式化为稳定的三位毫秒显示", () => {
    expect(formatTime(3_723_400_000)).toBe("01:02:03.400");
  });
});
