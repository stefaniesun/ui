import type { Rect, TextItem } from "@ui-rebuild/workbench-contracts";

export interface RawOcrLine {
  text: string;
  bounds: Rect;
  confidence: number;
}

export interface OcrProvider {
  recognize(imagePath: string): Promise<RawOcrLine[]>;
}

export function toLogicalTextItems(lines: RawOcrLine[], scale: number): TextItem[] {
  if (scale <= 0) {
    throw new Error("OCR scale must be positive");
  }

  return lines.map((line, index) => ({
    id: `text-${index + 1}`,
    text: line.text,
    bounds: {
      x: line.bounds.x / scale,
      y: line.bounds.y / scale,
      w: line.bounds.w / scale,
      h: line.bounds.h / scale,
    },
    lineHeightPx: line.bounds.h / scale,
    ocrConfidence: line.confidence,
    source: "tool",
    confidence: line.confidence,
    reviewed: false,
  }));
}

export async function measureText(provider: OcrProvider, imagePath: string, scale: number): Promise<TextItem[]> {
  return toLogicalTextItems(await provider.recognize(imagePath), scale);
}
