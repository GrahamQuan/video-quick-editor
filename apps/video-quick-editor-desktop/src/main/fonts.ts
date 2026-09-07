import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { validateWatermarkFont } from "@video-quick-editor/media-core";

const systemFonts = [
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
];

/** Preserve user selection; only automatic candidates must pass the bilingual sample. */
export async function findDefaultFont(
  selectedPath: string | null,
  candidates: readonly string[] = systemFonts,
): Promise<string | null> {
  if (selectedPath) {
    try {
      await access(selectedPath, constants.R_OK);
      return selectedPath;
    } catch {
      /* An unavailable saved selection can fall back to a system font. */
    }
  }
  for (const path of candidates) {
    try {
      await access(path, constants.R_OK);
      validateWatermarkFont(
        {
          enabled: true,
          text: "旅行记录 中文水印 Hello 0123",
          fontId: null,
          position: "bottom-right",
          fontSize: 32,
          borderWidth: 1,
          margin: 24,
        },
        path,
        4096,
        4096,
      );
      return path;
    } catch {
      /* Missing files, unreadable font faces or missing sample glyphs are skipped. */
    }
  }
  return null;
}
