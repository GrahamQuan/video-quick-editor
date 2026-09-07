declare module "fontkit" {
  interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    hasGlyphForCodePoint(code: number): boolean;
    layout(text: string): {
      positions: Array<{ xAdvance: number }>;
      bbox: { minX: number; maxX: number; minY: number; maxY: number };
    };
  }
  export function openSync(path: string): Font | { fonts: Font[] };
}
