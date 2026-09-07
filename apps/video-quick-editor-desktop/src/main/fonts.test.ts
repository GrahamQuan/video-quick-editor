import { it, expect } from "vitest";
import { findDefaultFont } from "./fonts.js";

it("selects an installed font with Chinese/Latin glyphs and skips invalid candidates", async () => {
  const font = await findDefaultFont(null, [
    "/missing/font.ttf",
    "/System/Library/Fonts/STHeiti Medium.ttc",
  ]);
  expect(font).toBe("/System/Library/Fonts/STHeiti Medium.ttc");
  expect(await findDefaultFont(font, [])).toBe(font);
  expect(await findDefaultFont("/missing/saved.ttf", [font!])).toBe(font);
  expect(await findDefaultFont(null, ["/missing/font.ttf"])).toBeNull();
});
