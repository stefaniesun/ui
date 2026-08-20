import { describe, expect, it } from "vitest";
import { analysisStats } from "./analysis-stats.js";
import type { ElementNode, IconDecision } from "./element-types.js";

const region = (id: string, y: number) => ({
  id, displayName: id, bounds: { x: 0, y, w: 375, h: 100 },
  confidence: 1, scrollX: false, scrollY: false,
});

const node = (id: string, iconDecision?: IconDecision) => ({
  id, parentId: null, box: { x: 0, y: 0, w: 24, h: 24 }, kind: "icon" as const,
  displayName: id, style: {}, uniformity: 1, iconDecision,
  source: "auto" as const, classification: "model" as const,
  scrollX: false, scrollY: false, positioning: "flow" as const,
});

const textNode = (id: string, over: Partial<ElementNode> = {}): ElementNode => ({
  id, parentId: null, box: { x: 0, y: 0, w: 40, h: 20 }, kind: "text",
  displayName: "文字", style: {}, uniformity: 1,
  source: "auto", classification: "model", scrollX: false, scrollY: false,
  positioning: "flow", ...over,
});

const statsWith = (nodes: ElementNode[]) => analysisStats(
  [region("a", 0)],
  [{ regionKey: "0-100", detectedAt: "now", nodes }],
  "Arial, sans-serif",
);

describe("analysisStats", () => {
  it("counts parsed regions and materialized icon outcomes", () => {
    const result = analysisStats(
      [region("a", 0), region("b", 100)],
      [{ regionKey: "0-100", detectedAt: "now", nodes: [
        node("home", { kind: "library", iconId: "mdi:home", query: "home", candidates: ["mdi:home"] }),
        node("brand", { kind: "crop", assetRef: "a.png", reason: "brand" }),
        node("unknown", { kind: "ambiguous", query: "x", candidates: ["mdi:close"] }),
      ] }],
    );
    expect(result).toMatchObject({
      totalRegions: 2, parsedRegions: 1, totalIcons: 3,
      libraryIcons: 1, cropIcons: 1, unresolvedIcons: 1, allPassed: false,
    });
    expect(result.todos).toContain("解析区域 b");
    expect(result.todos).toContain("确认图标 unknown");
    expect(result.todos).toContain("选择目标平台字体");
    expect(result.fontStackChosen).toBe(false);
  });

  describe("未测字号的计数", () => {
    it("ignores text whose box failed the check", () => {
      expect(statsWith([textNode("a", { textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" } })]).textWithoutSize).toBe(0);
    });

    it("ignores text that was never checked", () => {
      expect(statsWith([textNode("a")]).textWithoutSize).toBe(0);
    });

    it("counts text that passed the check but has no size yet", () => {
      expect(statsWith([textNode("a", { textBox: { ok: true, bands: 1, glyphAspect: 0.94 } })]).textWithoutSize).toBe(1);
    });

    it("stops counting once the size is measured", () => {
      expect(statsWith([textNode("a", { textBox: { ok: true, bands: 1, glyphAspect: 0.94 }, style: { fontSize: 34 } })]).textWithoutSize).toBe(0);
    });

    it("drops the todo when nothing measurable is left", () => {
      const stats = statsWith([textNode("a", { textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" } })]);
      expect(stats.todos.some(todo => todo.includes("字号"))).toBe(false);
      expect(stats.allPassed).toBe(true);
    });
  });
});
