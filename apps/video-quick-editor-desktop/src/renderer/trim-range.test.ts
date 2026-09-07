import { expect, it } from "vitest";
import { trimBoundary } from "./trim-range.js";
it("clamps handles to the source and prevents crossing while retaining integer microseconds", () => {
  const range = { startUs: 200000, endUs: 1600000 };
  expect(trimBoundary(range, "start", -100, 2000000)).toEqual({ startUs: 0, endUs: 1600000 });
  expect(trimBoundary(range, "start", 1900000, 2000000)).toEqual({
    startUs: 1599999,
    endUs: 1600000,
  });
  expect(trimBoundary(range, "end", -100, 2000000)).toEqual({ startUs: 200000, endUs: 200001 });
  expect(trimBoundary(range, "end", 9000000, 2000000)).toEqual({ startUs: 200000, endUs: 2000000 });
  expect(trimBoundary(range, "start", 300000.7, 2000000).startUs).toBe(300001);
  expect(range).toEqual({ startUs: 200000, endUs: 1600000 });
});
