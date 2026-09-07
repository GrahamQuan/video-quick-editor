import { openSync } from "fontkit";
import type { ExportRequest } from "@video-quick-editor/shared";
export function validateWatermarkFont(
  watermark: ExportRequest["watermark"],
  fontPath: string,
  width: number,
  height: number,
): void {
  if (!watermark.enabled) return;
  const opened = openSync(fontPath);
  const font = "fonts" in opened ? opened.fonts[0] : opened;
  if (!font) throw new Error("FONT_REQUIRED: 字体不可读 / Font cannot be read");
  for (const char of watermark.text)
    if (!font.hasGlyphForCodePoint(char.codePointAt(0)!))
      throw new Error(`FONT_REQUIRED: 字体缺少字形 / Missing glyph: ${char}`);
  const run = font.layout(watermark.text),
    scale = watermark.fontSize / font.unitsPerEm;
  const textWidth =
    Math.max(
      run.positions.reduce((sum, p) => sum + p.xAdvance, 0),
      run.bbox.maxX - run.bbox.minX,
    ) * scale;
  const textHeight = Math.max(run.bbox.maxY - run.bbox.minY, font.ascent - font.descent) * scale;
  const border = watermark.borderWidth ?? 1;
  if (
    textWidth + 2 * (watermark.margin + border) > width ||
    textHeight + 2 * (watermark.margin + border) > height
  )
    throw new Error(
      "INVALID_ARGUMENT: 水印超出画面，请减小字号、边距或缩短文字 / Watermark does not fit; reduce size, margin or text",
    );
}
