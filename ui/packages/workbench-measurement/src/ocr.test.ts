import { describe, expect, it } from "vitest";
import { measureText, toLogicalTextItems, type OcrProvider } from "./ocr.js";

const raw = [{ text: "会员中心", bounds: { x: 20, y: 40, w: 160, h: 32 }, confidence: 0.96 }];

describe("OCR measurement", () => {
  it("converts physical coordinates to logical pixels", () => {
    expect(toLogicalTextItems(raw, 2)[0]).toMatchObject({
      text: "会员中心",
      bounds: { x: 10, y: 20, w: 80, h: 16 },
      lineHeightPx: 16,
      source: "tool",
    });
  });

  it("uses a replaceable provider", async () => {
    const provider: OcrProvider = { recognize: async () => raw };
    await expect(measureText(provider, "reference.png", 2)).resolves.toHaveLength(1);
  });

  it("rejects invalid scale", () => {
    expect(() => toLogicalTextItems(raw, 0)).toThrow("positive");
  });
});
